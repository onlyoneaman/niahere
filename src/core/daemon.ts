import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "fs";
import { dirname, resolve as pathResolve } from "path";
import { fileURLToPath } from "url";
import { getPaths } from "../utils/paths";
import { getConfig, resetConfig } from "../utils/config";
import { log } from "../utils/log";
import { isRunning, readPid, removePid, writePid } from "../utils/pid";
import { ActiveEngine, Job } from "../db/models";
import { runMigrations } from "../db/migrate";
import { closeDb, getSql } from "../db/connection";
import { registerAllChannels, startChannels, stopChannels, getStarted } from "../channels";
import type { Channel } from "../types";
import { startScheduler, stopScheduler, recomputeAllNextRuns } from "./scheduler";
import { startAlive, stopAlive } from "./alive";
import { createNiaMcpServer } from "../mcp/server";
import { setMcpFactory } from "../mcp";
import { processPending, cleanupOldRequests } from "./finalizer";

export { isRunning, readPid, removePid, writePid };

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
  closeSync(logFd); // Child owns the fd now; close parent's copy to prevent leak
  const pid = proc.pid;
  writePid(pid);
  return pid;
}

export function stopDaemon(): boolean {
  const pidfilePid = readPid();
  removePid();

  // Kill all daemon processes — pidfile PID plus any orphans.
  const killed = killAllDaemons(pidfilePid);
  if (killed === 0 && pidfilePid === null) return false;

  // Wait for processes to finish (up to 5 min for active engines, then SIGKILL)
  waitForExit(310_000);
  return true;
}

/** Poll until no daemon processes remain. Escalate to SIGKILL after timeout. */
function waitForExit(timeoutMs: number): void {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const alive = findDaemonPids();
    if (alive.length === 0) return;
    Bun.sleepSync(100);
  }

  // Still alive — escalate to SIGKILL
  const remaining = findDaemonPids();
  for (const pid of remaining) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {}
  }

  // Brief wait for SIGKILL to take effect
  const killDeadline = Date.now() + 2_000;
  while (Date.now() < killDeadline) {
    if (findDaemonPids().length === 0) return;
    Bun.sleepSync(50);
  }
}

/** Return PIDs of running daemon processes (excluding ourselves). */
export function findDaemonPids(): number[] {
  try {
    const result = Bun.spawnSync(["pgrep", "-f", "src/cli/index\\.ts run$"]);
    const stdout = new TextDecoder().decode(result.stdout).trim();
    if (!stdout) return [];
    return stdout
      .split("\n")
      .map((l) => parseInt(l, 10))
      .filter((pid) => !isNaN(pid) && pid !== process.pid);
  } catch {
    return [];
  }
}

/** SIGTERM all running daemon processes (pidfile PID + any found via pgrep). */
function killAllDaemons(knownPid?: number | null): number {
  const toKill = new Set<number>(findDaemonPids());
  if (knownPid && knownPid !== process.pid) toKill.add(knownPid);

  for (const pid of toKill) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {}
  }
  return toKill.size;
}

// ---------------------------------------------------------------------------
// System jobs — auto-installed on daemon startup
// ---------------------------------------------------------------------------

/**
 * Ensure system jobs exist. Uses create-if-not-exists semantics so user
 * customizations (via `nia job update/disable`) are preserved across restarts.
 * Currently manages: memory-promoter.
 */
async function bootstrapSystemJobs(): Promise<void> {
  const here = dirname(fileURLToPath(import.meta.url));

  const systemJobs = [
    {
      name: "memory-promoter",
      schedule: "0 3 * * *",
      scheduleType: "cron" as const,
      always: true,
      stateless: true,
      promptPath: pathResolve(here, "../../defaults/memory-promoter.md"),
    },
  ];

  for (const j of systemJobs) {
    const existing = await Job.get(j.name);
    if (existing) continue;

    if (!existsSync(j.promptPath)) {
      log.warn({ job: j.name, promptPath: j.promptPath }, "system job prompt missing, skipping bootstrap");
      continue;
    }

    const prompt = readFileSync(j.promptPath, "utf8");
    await Job.create(j.name, j.schedule, prompt, j.always, j.scheduleType, undefined, undefined, j.stateless);
    log.info({ job: j.name, schedule: j.schedule }, "bootstrapped system job");
  }
}

export async function runDaemon(): Promise<void> {
  // Ensure we never pass nested-session env vars to SDK subprocesses,
  // regardless of how the daemon was launched (nia start, nia run, etc.)
  delete process.env.CLAUDECODE;
  delete process.env.CLAUDE_CODE_ENTRYPOINT;
  delete process.env.CLAUDE_AGENT_SDK_VERSION;

  // Startup guard: if another nia daemon is alive, exit immediately.
  // Use pgrep (via findDaemonPids) instead of kill(pid,0) to verify the
  // PID is actually a nia process — not a recycled OS PID from something else.
  const existingPid = readPid();
  if (existingPid !== null && existingPid !== process.pid) {
    const aliveDaemons = findDaemonPids();
    if (aliveDaemons.includes(existingPid)) {
      log.debug({ existingPid, myPid: process.pid }, "another daemon is already running, exiting");
      process.exit(0);
    }
    // PID in file is stale (dead or recycled by OS) — safe to take over
    log.warn({ stalePid: existingPid }, "taking over from stale pid");
    removePid();
  }

  // Crash handlers — ensure PID cleanup and logging on unhandled errors.
  // Without these, an unhandled rejection kills the process silently,
  // leaving a stale PID file that blocks restarts and hides the cause.
  process.on("uncaughtException", (err) => {
    log.fatal({ err }, "uncaught exception — cleaning up");
    removePid();
    process.exit(1);
  });
  process.on("unhandledRejection", (reason) => {
    const err = reason instanceof Error ? reason : new Error(String(reason));
    log.fatal({ err }, "unhandled rejection — cleaning up");
    removePid();
    process.exit(1);
  });

  writePid(process.pid);
  log.info({ pid: process.pid }, "daemon started");

  // Check for updates (non-blocking, logged only)
  try {
    const { checkForUpdate } = await import("../utils/update");
    const { version } = await import("../../package.json");
    const update = await checkForUpdate(version);
    if (update) {
      log.warn(
        { current: update.current, latest: update.latest },
        "update available — run `npm i -g niahere` to update",
      );
    }
  } catch {}

  // Ensure watches dir exists — used for file-backed watch behaviors and
  // per-watch working memory. Safe to call on every startup.
  try {
    mkdirSync(getPaths().watchesDir, { recursive: true });
  } catch (err) {
    log.warn({ err }, "failed to ensure watches dir");
  }

  // Ensure staging.md exists — used by the memory consolidator to stage
  // candidate memories before the nightly promoter reviews them. Existing
  // installs that pre-date two-stage memory get a seed file on next start.
  try {
    const stagingPath = `${getPaths().selfDir}/staging.md`;
    if (!existsSync(stagingPath)) {
      const here = dirname(fileURLToPath(import.meta.url));
      const seed = pathResolve(here, "../../defaults/self/staging.md");
      if (existsSync(seed)) {
        mkdirSync(getPaths().selfDir, { recursive: true });
        writeFileSync(stagingPath, readFileSync(seed, "utf8"));
        log.info({ stagingPath }, "seeded staging.md from defaults");
      }
    }
  } catch (err) {
    log.warn({ err }, "failed to ensure staging.md");
  }

  // Startup recovery
  try {
    await runMigrations();
    await ActiveEngine.clearAll();
    log.info("cleared stale active engines from previous run");
  } catch (err) {
    log.warn({ err }, "startup recovery: postgres unavailable, skipping");
  }

  // Seed system jobs (create-if-not-exists). Currently: memory-promoter.
  // Users can disable or customize these via `nia job disable/update`.
  try {
    await bootstrapSystemJobs();
  } catch (err) {
    log.warn({ err }, "failed to bootstrap system jobs");
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

  // Initialize MCP server factory (each query gets its own Protocol instance)
  setMcpFactory(() => ({ nia: createNiaMcpServer() }));
  log.info("MCP server factory initialized");

  // Register and start channels
  registerAllChannels();
  let channels: Channel[] = [];
  const config = getConfig();
  if (config.channels.enabled) {
    const result = await startChannels();
    channels = result.started;
  } else {
    log.info("channels disabled (channels_enabled: false)");
  }

  // Recompute next_run_at for jobs that don't have one (legacy cron jobs)
  try {
    await recomputeAllNextRuns();
  } catch (err) {
    log.warn({ err }, "failed to recompute next_run_at");
  }

  // Start unified scheduler (replaces node-cron)
  startScheduler();

  // Start alive monitor (DB heartbeat + recovery)
  startAlive();

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

  // Listen for session finalization requests from CLI processes
  try {
    const sql = getSql();
    await sql.listen("nia_finalize", async () => {
      log.info("finalization request received via NOTIFY, processing pending");
      await processPending().catch((err) => {
        log.warn({ err }, "failed to process pending finalizations on notify");
      });
    });
    log.info("listening for finalization requests on nia_finalize channel");
  } catch (err) {
    log.warn({ err }, "could not subscribe to nia_finalize");
  }

  // Drain any finalization requests that arrived while daemon was down
  processPending().catch((err) => {
    log.warn({ err }, "startup: failed to drain pending finalizations");
  });

  // Clean up old finalization requests every 24h
  setInterval(
    () => {
      cleanupOldRequests().catch((err) => {
        log.warn({ err }, "failed to cleanup old finalization requests");
      });
    },
    24 * 60 * 60 * 1000,
  );

  // SIGHUP: reload config, reconcile channels, recompute jobs
  process.on("SIGHUP", async () => {
    log.info("received SIGHUP, reloading config");
    resetConfig();
    const fresh = getConfig();

    const running = getStarted();
    const wantChannels = fresh.channels.enabled;
    const haveChannels = running.length > 0;

    if (wantChannels && !haveChannels) {
      log.info("SIGHUP: starting channels");
      const result = await startChannels();
      channels = result.started;
    } else if (!wantChannels && haveChannels) {
      log.info("SIGHUP: stopping channels");
      await stopChannels(running);
      channels = [];
    }

    await recomputeAllNextRuns().catch(() => {});
  });

  let shuttingDown = false;

  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;

    log.info("shutting down...");

    stopAlive();
    stopScheduler();
    await stopChannels(channels);

    try {
      const engines = await ActiveEngine.list();
      if (engines.length > 0) {
        log.info({ count: engines.length }, "waiting for active engines to finish");
        const deadline = Date.now() + 300_000;
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
