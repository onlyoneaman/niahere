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
import "../channels/slack"; // side-effect: registers channel factory

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

  // Strip Claude Code env vars so the daemon (and any SDK subprocesses it
  // spawns) don't think they're running inside a nested Claude Code session.
  const cleanEnv = { ...process.env };
  delete cleanEnv.CLAUDECODE;
  delete cleanEnv.CLAUDE_CODE_ENTRYPOINT;
  delete cleanEnv.CLAUDE_AGENT_SDK_VERSION;

  const proc = Bun.spawn([execPath, scriptPath, "run"], {
    stdio: ["ignore", logFd, logFd],
    env: cleanEnv,
  });

  proc.unref();
  const pid = proc.pid;
  writePid(pid);
  return pid;
}

export function stopDaemon(): boolean {
  const pidfilePid = readPid();
  removePid();

  // Kill all daemon processes — pidfile PID plus any orphans.
  const killed = killAllDaemons(pidfilePid);
  return pidfilePid !== null || killed > 0;
}

/** Find and SIGTERM all `niahere ... run` processes except ourselves. */
function killAllDaemons(knownPid?: number | null): number {
  const toKill = new Set<number>();
  if (knownPid) toKill.add(knownPid);

  try {
    const result = Bun.spawnSync(["pgrep", "-f", "niahere/src/cli.* run"]);
    const stdout = new TextDecoder().decode(result.stdout).trim();
    if (stdout) {
      for (const line of stdout.split("\n")) {
        const pid = parseInt(line, 10);
        if (!isNaN(pid)) toKill.add(pid);
      }
    }
  } catch {
    // pgrep not available — fall through with just knownPid
  }

  toKill.delete(process.pid);

  for (const pid of toKill) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // Already dead
    }
  }
  return toKill.size;
}

export async function runDaemon(): Promise<void> {
  // Ensure we never pass nested-session env vars to SDK subprocesses,
  // regardless of how the daemon was launched (nia start, nia run, etc.)
  delete process.env.CLAUDECODE;
  delete process.env.CLAUDE_CODE_ENTRYPOINT;
  delete process.env.CLAUDE_AGENT_SDK_VERSION;

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
