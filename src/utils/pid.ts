import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { dirname } from "path";
import { getPaths } from "./paths";
import { log } from "./log";

type PidEntry = { pid: number; lstart: string };

function getLstart(pid: number): string {
  try {
    const result = Bun.spawnSync(["ps", "-o", "lstart=", "-p", String(pid)]);
    return new TextDecoder().decode(result.stdout).trim();
  } catch {
    return "";
  }
}

export function writePid(pid: number): void {
  const { pid: pidPath } = getPaths();
  const lstart = getLstart(pid);
  if (!lstart) {
    log.warn({ pid }, "could not capture pid identity (ps returned nothing)");
  }
  mkdirSync(dirname(pidPath), { recursive: true });
  writeFileSync(pidPath, JSON.stringify({ pid, lstart }));
}

function readEntry(): PidEntry | null {
  const { pid: pidPath } = getPaths();
  if (!existsSync(pidPath)) return null;

  try {
    const raw = readFileSync(pidPath, "utf8").trim();
    if (/^\d+$/.test(raw)) {
      return { pid: parseInt(raw, 10), lstart: "" };
    }
    const parsed = JSON.parse(raw);
    if (typeof parsed?.pid === "number" && typeof parsed?.lstart === "string") {
      return parsed as PidEntry;
    }
    return null;
  } catch {
    return null;
  }
}

export function readPid(): number | null {
  return readEntry()?.pid ?? null;
}

export function removePid(): void {
  const { pid: pidPath } = getPaths();
  try {
    unlinkSync(pidPath);
  } catch {
    // Already gone
  }
}

export function isRunning(): boolean {
  const entry = readEntry();
  if (entry === null) return false;

  const currentLstart = getLstart(entry.pid);
  if (!currentLstart) {
    log.warn({ stalePid: entry.pid }, "removing stale pid file (process not running)");
    removePid();
    return false;
  }
  if (entry.lstart && currentLstart !== entry.lstart) {
    log.warn(
      { stalePid: entry.pid, recorded: entry.lstart, current: currentLstart },
      "removing stale pid file (process identity mismatch)",
    );
    removePid();
    return false;
  }
  return true;
}
