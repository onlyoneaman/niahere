/**
 * Guard against stopping/restarting while active engines are running.
 *
 * Default: warn and refuse.
 * --wait <minutes>: poll until engines clear, then proceed. Times out with error.
 * --force: skip the guard and ask the daemon to close active handles.
 */

import { ActiveEngine } from "../db/models";
import { withDb } from "../db/with-db";
import { DIM, RESET, ICON_WARN } from "../utils/cli";

export interface GuardOptions {
  /** Wait up to this many minutes for engines to clear. 0 = don't wait (default). */
  waitMinutes: number;
  /** Skip the guard entirely. */
  force: boolean;
}

export function parseGuardFlags(args: string[]): GuardOptions {
  const force = args.includes("--force") || args.includes("-f");

  let waitMinutes = 0;
  const waitIdx = args.indexOf("--wait");
  if (waitIdx !== -1 && args[waitIdx + 1]) {
    const parsed = parseInt(args[waitIdx + 1], 10);
    if (!isNaN(parsed) && parsed > 0) waitMinutes = parsed;
  }

  return { waitMinutes, force };
}

export function withDefaultWait(opts: GuardOptions, defaultWaitMinutes: number): GuardOptions {
  if (opts.force || opts.waitMinutes > 0) return opts;
  return { ...opts, waitMinutes: defaultWaitMinutes };
}

interface ActiveSummary {
  count: number;
  rooms: string[];
}

async function getActiveEngines(): Promise<ActiveSummary> {
  let count = 0;
  let rooms: string[] = [];
  try {
    await withDb(async () => {
      const engines = await ActiveEngine.list();
      count = engines.length;
      rooms = engines.map((e) => `${e.room} (${e.channel})`);
    });
  } catch {
    // DB unreachable — no engines to worry about
  }
  return { count, rooms };
}

/**
 * Check for active engines before a destructive operation.
 * Returns true if safe to proceed, false if blocked.
 */
export async function guardActiveEngines(action: string, opts: GuardOptions): Promise<boolean> {
  if (opts.force) return true;

  const { count, rooms } = await getActiveEngines();
  if (count === 0) return true;

  // Active engines found
  console.log(`\n${ICON_WARN} ${count} active engine${count > 1 ? "s" : ""} running:`);
  for (const room of rooms) {
    console.log(`  ${DIM}${room}${RESET}`);
  }

  if (opts.waitMinutes === 0) {
    // Default: refuse
    console.log(`\nCannot ${action} while engines are active.`);
    console.log(`${DIM}Options:${RESET}`);
    console.log(`  --wait <minutes>  Wait for engines to finish (checks every 5s)`);
    console.log(`  --force           ${action} immediately, killing active sessions`);
    return false;
  }

  // --wait: poll until clear or timeout
  const deadlineMs = opts.waitMinutes * 60 * 1000;
  const deadline = Date.now() + deadlineMs;
  console.log(`\nWaiting up to ${opts.waitMinutes}m for engines to finish...`);

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 5_000));
    const { count: remaining } = await getActiveEngines();
    if (remaining === 0) {
      console.log("All engines finished.");
      return true;
    }
    const left = Math.ceil((deadline - Date.now()) / 1000);
    process.stdout.write(`\r${DIM}  ${remaining} active, ${left}s remaining${RESET}`);
  }

  process.stdout.write("\n");
  console.log(`\nTimed out — ${count} engine${count > 1 ? "s" : ""} still active.`);
  console.log(`Use --force to ${action} anyway.`);
  return false;
}
