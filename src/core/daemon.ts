import { existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { dirname } from "path";
import cron from "node-cron";
import { getPaths } from "../utils/paths";
import { loadConfig } from "../utils/config";
import { runJob } from "./runner";
import { log } from "../utils/log";
import { ActiveEngine, Job as JobModel } from "../db/models";
import { runMigrations } from "../db/migrate";
import { closeDb } from "../db/connection";
import { startChannels, stopChannels, type Channel } from "../channels";
import "../channels/telegram"; // side-effect: registers channel factory

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

  writePid(workspace, process.pid);
  log.info({ pid: process.pid }, "daemon started");

  // Startup recovery
  try {
    await runMigrations();
    await ActiveEngine.clearAll();
    log.info("cleared stale active engines from previous run");
  } catch (err) {
    log.warn({ err }, "startup recovery: postgres unavailable, skipping");
  }

  // Clear stale "running" job states
  const { readState, writeState } = await import("../utils/logger");
  const state = readState(workspace);
  let recovered = 0;
  for (const [name, info] of Object.entries(state)) {
    if (info.status === "running") {
      state[name] = { ...info, status: "error", error: "daemon crashed during execution" };
      recovered++;
    }
  }
  if (recovered > 0) {
    writeState(workspace, state);
    log.info({ recovered }, "recovered stale running jobs");
  }

  // Start channels (telegram, etc.)
  let channels: Channel[] = [];
  channels = await startChannels(workspace);

  // Schedule jobs from DB
  async function scheduleJobs() {
    // Stop all existing cron tasks
    const tasks = cron.getTasks();
    for (const [, task] of tasks) {
      task.stop();
    }

    let jobs: { name: string; schedule: string; prompt: string }[];
    try {
      jobs = await JobModel.listEnabled();
    } catch {
      // DB unavailable — fall back to YAML
      const { parseJobs } = await import("./cron");
      jobs = parseJobs(workspace).filter((j) => j.enabled);
    }

    for (const job of jobs) {
      log.info({ job: job.name, schedule: job.schedule }, "scheduling job");
      cron.schedule(
        job.schedule,
        async () => {
          log.info({ job: job.name }, "running job");
          const result = await runJob(workspace, job, config.model);
          log.info({ job: job.name, status: result.status, duration: result.duration_ms }, "job completed");
        },
        { timezone: config.timezone },
      );
    }

    log.info({ count: jobs.length }, "jobs scheduled");
  }

  await scheduleJobs();

  // SIGHUP reloads jobs from DB
  process.on("SIGHUP", async () => {
    log.info("received SIGHUP, reloading jobs");
    await scheduleJobs();
  });

  let shuttingDown = false;

  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;

    log.info("shutting down...");

    // Stop channels
    await stopChannels(channels);

    // Drain active engines (wait up to 30s)
    try {
      const engines = await ActiveEngine.list();
      if (engines.length > 0) {
        log.info({ count: engines.length }, "waiting for active engines to finish");
        const deadline = Date.now() + 30_000;
        while (Date.now() < deadline) {
          const remaining = await ActiveEngine.list();
          if (remaining.length === 0) break;
          await new Promise((r) => setTimeout(r, 1000));
        }
        await ActiveEngine.clearAll();
      }
    } catch {
      // postgres may be gone
    }

    // Stop all cron tasks
    const tasks = cron.getTasks();
    for (const [, task] of tasks) {
      task.stop();
    }

    try {
      await closeDb();
    } catch {
      // ignore
    }

    removePid(workspace);
    log.info("shutdown complete");
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  // Keep process alive
  await new Promise(() => {});
}
