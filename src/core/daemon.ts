import { existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { dirname } from "path";
import cron from "node-cron";
import { getPaths } from "../utils/paths";
import { loadConfig } from "../utils/config";
import { parseJobs } from "./cron";
import { runJob } from "./runner";
import { localTime } from "../utils/time";

function log(msg: string): void {
  console.log(`[${localTime()}] ${msg}`);
}

export function writePid(workspace: string, pid: number): void {
  const { pid: pidPath } = getPaths(workspace);
  mkdirSync(dirname(pidPath), { recursive: true });
  writeFileSync(pidPath, String(pid));
}

export function readPid(workspace: string): number | null {
  const { pid: pidPath } = getPaths(workspace);
  if (!existsSync(pidPath)) return null;

  try {
    return parseInt(readFileSync(pidPath, "utf8").trim(), 10);
  } catch {
    return null;
  }
}

export function removePid(workspace: string): void {
  const { pid: pidPath } = getPaths(workspace);
  try {
    unlinkSync(pidPath);
  } catch {
    // Already gone
  }
}

export function isRunning(workspace: string): boolean {
  const pid = readPid(workspace);
  if (pid === null) return false;

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    // Process not found — stale PID
    removePid(workspace);
    return false;
  }
}

export function startDaemon(workspace: string): number {
  const { daemonLog } = getPaths(workspace);
  mkdirSync(dirname(daemonLog), { recursive: true });
  const logFd = openSync(daemonLog, "a");

  const proc = Bun.spawn(["bun", "run", "src/cli.ts", "run"], {
    cwd: workspace,
    stdio: ["ignore", logFd, logFd],
    env: { ...process.env },
  });

  // Unref so parent can exit
  proc.unref();
  const pid = proc.pid;
  writePid(workspace, pid);
  return pid;
}

export function stopDaemon(workspace: string): boolean {
  const pid = readPid(workspace);
  if (pid === null) return false;

  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // Already dead
  }

  removePid(workspace);
  return true;
}

export async function runDaemon(workspace: string): Promise<void> {
  const config = loadConfig(workspace);
  const jobs = parseJobs(workspace).filter((j) => j.enabled);

  writePid(workspace, process.pid);

  log(`[nia] daemon started (pid: ${process.pid}, jobs: ${jobs.length})`);

  const shutdown = () => {
    log("[nia] shutting down...");
    removePid(workspace);
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  for (const job of jobs) {
    log(`[nia] scheduling "${job.name}" → ${job.schedule}`);
    cron.schedule(job.schedule, async () => {
      log(`[nia] running job: ${job.name}`);
      const result = await runJob(workspace, job, config.model);
      log(`[nia] job "${job.name}" ${result.status} (${result.duration_ms}ms)`);
    });
  }

  // Keep process alive
  await new Promise(() => {});
}
