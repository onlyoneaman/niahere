import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { dirname } from "path";
import cron from "node-cron";
import { getPaths } from "./paths";
import { loadConfig } from "./config";
import { parseJobs } from "./cron";
import { runJob } from "./runner";

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
  const proc = Bun.spawn(["bun", "run", "src/cli.ts", "run"], {
    cwd: workspace,
    stdio: ["ignore", "ignore", "ignore"],
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

  console.log(`[niahere] daemon started (pid: ${process.pid}, jobs: ${jobs.length})`);

  const shutdown = () => {
    console.log("[niahere] shutting down...");
    removePid(workspace);
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  for (const job of jobs) {
    console.log(`[niahere] scheduling "${job.name}" → ${job.schedule}`);
    cron.schedule(job.schedule, async () => {
      console.log(`[niahere] running job: ${job.name}`);
      const result = await runJob(workspace, job, config.model);
      console.log(`[niahere] job "${job.name}" ${result.status} (${result.duration_ms}ms)`);
    });
  }

  // Keep process alive
  await new Promise(() => {});
}
