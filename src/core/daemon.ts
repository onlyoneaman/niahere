import { existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { dirname } from "path";
import { getPaths } from "../utils/paths";
import { getConfig } from "../utils/config";
import { log } from "../utils/log";
import { ActiveEngine } from "../db/models";
import { runMigrations } from "../db/migrate";
import { closeDb, getSql } from "../db/connection";
import { startChannels, stopChannels, type Channel } from "../channels";
import { startScheduler, stopScheduler, recomputeAllNextRuns } from "./scheduler";
import { createNiaMcpServer } from "../mcp/server";
import { setMcpServers } from "../mcp";
import "../channels/telegram"; // side-effect: registers channel factory

export function writePid(pid: number): void {
  const { pid: pidPath } = getPaths();
  mkdirSync(dirname(pidPath), { recursive: true });
  writeFileSync(pidPath, String(pid));
}

export function readPid(): number | null {
  const { pid: pidPath } = getPaths();
  if (!existsSync(pidPath)) return null;

  try {
    return parseInt(readFileSync(pidPath, "utf8").trim(), 10);
  } catch {
    return null;
  }
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
  const pid = readPid();
  if (pid === null) return false;

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    removePid();
    return false;
  }
}

export function startDaemon(): number {
  const { daemonLog } = getPaths();
  mkdirSync(dirname(daemonLog), { recursive: true });
  const logFd = openSync(daemonLog, "a");

  // Use the same executable and script that invoked us
  const execPath = process.execPath;
  const scriptPath = process.argv[1];

  const proc = Bun.spawn([execPath, scriptPath, "run"], {
    stdio: ["ignore", logFd, logFd],
    env: { ...process.env },
  });

  proc.unref();
  const pid = proc.pid;
  writePid(pid);
  return pid;
}

export function stopDaemon(): boolean {
  const pid = readPid();
  if (pid === null) return false;

  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // Already dead
  }

  removePid();
  return true;
}

export async function runDaemon(): Promise<void> {
  writePid(process.pid);
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
  const state = readState();
  let recovered = 0;
  for (const [name, info] of Object.entries(state)) {
    if (info.status === "running") {
      state[name] = { ...info, status: "error", error: "daemon crashed during execution" };
      recovered++;
    }
  }
  if (recovered > 0) {
    writeState(state);
    log.info({ recovered }, "recovered stale running jobs");
  }

  // Initialize MCP server (in-process, no HTTP needed)
  try {
    const mcpConfig = createNiaMcpServer();
    setMcpServers({ nia: mcpConfig });
    log.info("MCP server initialized");
  } catch (err) {
    log.error({ err }, "failed to initialize MCP server");
  }

  // Start channels (telegram, etc.)
  let channels: Channel[] = [];
  channels = await startChannels();

  // Recompute next_run_at for jobs that don't have one (legacy cron jobs)
  try {
    await recomputeAllNextRuns();
  } catch (err) {
    log.warn({ err }, "failed to recompute next_run_at");
  }

  // Start unified scheduler (replaces node-cron)
  startScheduler();

  // Listen for job changes via Postgres LISTEN/NOTIFY
  try {
    const sql = getSql();
    await sql.listen("nia_jobs", async () => {
      log.info("job change detected via NOTIFY, recomputing next runs");
      await recomputeAllNextRuns().catch((err) => {
        log.warn({ err }, "failed to recompute next runs on notify");
      });
    });
    log.info("listening for job changes on nia_jobs channel");
  } catch (err) {
    log.warn({ err }, "could not subscribe to nia_jobs, falling back to SIGHUP only");
  }

  // SIGHUP as manual fallback
  process.on("SIGHUP", async () => {
    log.info("received SIGHUP, recomputing job schedules");
    await recomputeAllNextRuns().catch(() => {});
  });

  let shuttingDown = false;

  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;

    log.info("shutting down...");

    stopScheduler();
    await stopChannels(channels);

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

    try {
      await closeDb();
    } catch {
      // ignore
    }

    removePid();
    log.info("shutdown complete");
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  await new Promise(() => {});
}
