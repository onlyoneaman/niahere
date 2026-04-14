import { isRunning, readPid } from "../core/daemon";
import { readState } from "../utils/logger";
import { getConfig } from "../utils/config";
import { localTime } from "../utils/time";
import { maskToken, safeDate, dateSortValue, formatTimeLine } from "../utils/format";
import { Message, ActiveEngine, Job } from "../db/models";
import type { ScheduleType, JobStateStatus, RoomStats } from "../types";
import { withDb } from "../db/with-db";
import { errMsg } from "../utils/errors";
import { checkForUpdate } from "../utils/update";
import { ICON_PASS, ICON_FAIL, ICON_RUNNING } from "../utils/cli";
import { formatDuration } from "../utils/format";

type StatusOptions = {
  json: boolean;
  all: boolean;
  roomLimit: number;
};

type JobStatusLine = {
  name: string;
  schedule: string;
  jobStatus: string;
  always: boolean;
  scheduleType: ScheduleType;
  agent: string | null;
  status: JobStateStatus | "never";
  lastRun: string | null;
  nextRunAt: string | null;
  durationMs: number | null;
  lastRunText: string;
  nextRunText: string;
  error?: string;
};

function parseStatusArgs(argv: string[]): StatusOptions {
  const opts: StatusOptions = { json: false, all: false, roomLimit: 10 };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--json") {
      opts.json = true;
    } else if (arg === "--all") {
      opts.all = true;
    } else if (arg === "--rooms" && argv[i + 1]) {
      const value = Number.parseInt(argv[i + 1], 10);
      if (Number.isInteger(value) && value > 0) {
        opts.roomLimit = value;
        i += 1;
      }
    } else if (arg.startsWith("--rooms=")) {
      const value = Number.parseInt(arg.slice(8), 10);
      if (Number.isInteger(value) && value > 0) opts.roomLimit = value;
    }
  }
  if (opts.all) opts.roomLimit = Number.MAX_SAFE_INTEGER;
  return opts;
}

export async function statusCommand(argv: string[] = []): Promise<void> {
  const options = parseStatusArgs(argv);
  const now = new Date();
  const running = isRunning();
  const pid = readPid();
  const config = getConfig();
  const state = readState();

  let jobs: Awaited<ReturnType<typeof Job.list>> = [];
  let engines: Awaited<ReturnType<typeof ActiveEngine.list>> = [];
  let rooms: RoomStats[] = [];
  let dbError: unknown = null;

  try {
    await withDb(async () => {
      jobs = await Job.list();
      engines = await ActiveEngine.list();
      rooms = await Message.getRoomStats();
    });
  } catch (error) {
    dbError = error;
  }

  const channels = {
    telegram: {
      configured: Boolean(config.channels.telegram.bot_token),
      status: !config.channels.telegram.bot_token
        ? "not configured"
        : !config.channels.enabled
          ? "disabled"
          : running
            ? "active"
            : "configured",
      tokenSuffix: config.channels.telegram.bot_token ? maskToken(config.channels.telegram.bot_token) : null,
    },
    slack: {
      configured: Boolean(config.channels.slack.bot_token),
      appTokenConfigured: Boolean(config.channels.slack.app_token),
      status: !config.channels.slack.bot_token
        ? "not configured"
        : !config.channels.enabled
          ? "disabled"
          : running
            ? config.channels.slack.app_token
              ? "active"
              : "configured (missing app token)"
            : "configured",
      tokenSuffix: config.channels.slack.bot_token ? maskToken(config.channels.slack.bot_token) : null,
    },
    defaultChannel: config.channels.default,
  };

  if (options.json) {
    const sortedJobs = [...jobs].sort(
      (a, b) =>
        (b.status === "active" ? 1 : 0) - (a.status === "active" ? 1 : 0) ||
        dateSortValue(a.nextRunAt) - dateSortValue(b.nextRunAt) ||
        a.name.localeCompare(b.name),
    );

    const jobsPayload: JobStatusLine[] = sortedJobs.map((job) => {
      const stateInfo = state[job.name];
      const lastRun = stateInfo?.lastRun ? stateInfo.lastRun : (job.lastRunAt ?? null);
      return {
        name: job.name,
        schedule: job.schedule,
        jobStatus: job.status,
        always: job.always,
        scheduleType: job.scheduleType,
        agent: job.agent,
        status: stateInfo?.status ?? (job.lastRunAt ? "ok" : "never"),
        lastRun: safeDate(lastRun)?.toISOString() ?? null,
        nextRunAt: safeDate(job.nextRunAt)?.toISOString() ?? null,
        durationMs: stateInfo?.duration_ms ?? null,
        error: stateInfo?.error,
        lastRunText: formatTimeLine(lastRun, now),
        nextRunText: formatTimeLine(job.nextRunAt, now),
      };
    });

    const fallbackJobs = dbError
      ? Object.entries(state)
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([name, info]) => {
            const lastRun = safeDate(info.lastRun)?.toISOString() ?? null;
            return {
              name,
              schedule: "unavailable",
              jobStatus: "disabled",
              always: false,
              scheduleType: "cron",
              agent: null,
              status: info.status,
              lastRun,
              nextRunAt: null,
              durationMs: info.duration_ms,
              error: info.error,
              lastRunText: formatTimeLine(lastRun, now),
              nextRunText: "unknown",
            };
          })
      : [];

    const engineRows = engines
      .map((engine) => ({
        room: engine.room,
        channel: engine.channel,
        startedAt: safeDate(engine.startedAt)?.toISOString() ?? null,
        lastPing: safeDate(engine.lastPing)?.toISOString() ?? null,
        startedAgo: formatTimeLine(engine.startedAt, now),
        lastPingAgo: formatTimeLine(engine.lastPing, now),
      }))
      .sort((a, b) => dateSortValue(b.startedAt) - dateSortValue(a.startedAt));

    const roomRows = rooms
      .map((room) => ({
        room: room.room,
        sessions: room.sessions,
        messages: room.messages,
        lastActivity: safeDate(room.lastActivity)?.toISOString() ?? null,
        lastActivityAgo: formatTimeLine(room.lastActivity, now),
      }))
      .sort((a, b) => b.messages - a.messages || dateSortValue(b.lastActivity) - dateSortValue(a.lastActivity));

    const report = {
      daemon: {
        running,
        pid: running ? pid : null,
        state: running ? "running" : "stopped",
      },
      channels,
      jobs: dbError ? fallbackJobs : jobsPayload,
      activeEngines: engineRows,
      rooms: roomRows,
      counts: {
        jobs: dbError ? fallbackJobs.length : jobsPayload.length,
        activeEngines: engineRows.length,
        rooms: roomRows.length,
      },
      db: {
        accessible: dbError === null,
        error: dbError ? errMsg(dbError) : null,
      },
    };

    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(`nia: ${running ? `running (pid: ${pid})` : "stopped"}`);
  console.log("Channels:");
  console.log(
    `  telegram: ${channels.telegram.status}${
      channels.telegram.tokenSuffix ? ` (${channels.telegram.tokenSuffix})` : ""
    }`,
  );
  console.log(
    `  slack: ${channels.slack.status}${
      channels.slack.tokenSuffix ? ` (${channels.slack.tokenSuffix})` : ""
    }${channels.slack.configured && !channels.slack.appTokenConfigured ? " (app token needed)" : ""}`,
  );
  if (channels.defaultChannel !== "telegram") {
    console.log(`  default channel: ${channels.defaultChannel}`);
  }

  if (dbError) {
    console.log(`  db: unavailable (${errMsg(dbError)})`);
  } else {
    console.log("  db: accessible");
  }

  if (!dbError) {
    if (jobs.length > 0) {
      console.log("\nJobs:");
      const sortedJobs = [...jobs].sort(
        (a, b) =>
          (b.status === "active" ? 1 : 0) - (a.status === "active" ? 1 : 0) ||
          dateSortValue(a.nextRunAt) - dateSortValue(b.nextRunAt) ||
          a.name.localeCompare(b.name),
      );

      // Hide completed one-shot jobs
      const visibleJobs = sortedJobs.filter(
        (j) => j.status !== "archived" && !(j.scheduleType === "once" && j.status !== "active" && j.lastRunAt),
      );

      for (const job of visibleJobs) {
        const stateInfo = state[job.name];
        const status = stateInfo?.status ?? (job.lastRunAt ? "ok" : "never");
        const lastRun = stateInfo?.lastRun ?? job.lastRunAt ?? null;
        const nextRun = job.nextRunAt ?? null;
        const stale =
          job.status === "active" &&
          status !== "running" &&
          nextRun !== null &&
          safeDate(nextRun) !== null &&
          safeDate(nextRun)!.getTime() <= now.getTime() &&
          !stateInfo;

        const statusIcon =
          status === "ok" ? ICON_PASS : status === "error" ? ICON_FAIL : status === "running" ? ICON_RUNNING : "\u2217";
        const durationText = stateInfo?.duration_ms === undefined ? "n/a" : formatDuration(stateInfo.duration_ms);
        const nextText = nextRun ? formatTimeLine(nextRun, now) : "unknown";
        const lastText = lastRun ? formatTimeLine(lastRun, now) : "never";
        const staleText = stale ? "  ⚠ stale" : "";

        const agentTag = job.agent ? `  [${job.agent}]` : "";
        const empTag = job.employee ? `  [emp:${job.employee}]` : "";
        console.log(
          `  ${job.status === "active" ? "\u25cf" : "\u25cb"} ${job.name.padEnd(20)} ${job.status}${agentTag}${empTag}`,
        );
        console.log(
          `      ${statusIcon} ${status}   last: ${lastText}   next: ${nextText}   duration: ${durationText}${staleText}`,
        );
      }
    } else {
      console.log("\nJobs: none");
    }

    console.log(`\nActive engines: ${engines.length === 0 ? "none" : ""}`);
    for (const engine of engines.sort((a, b) => dateSortValue(a.startedAt) - dateSortValue(b.startedAt))) {
      const started = formatTimeLine(engine.startedAt, now);
      const ping = formatTimeLine(engine.lastPing, now);
      console.log(`  ${engine.room} (${engine.channel}) • started ${started} • last ping ${ping}`);
    }

    const sortedRooms = [...rooms].sort(
      (a, b) =>
        b.messages - a.messages ||
        dateSortValue(b.lastActivity) - dateSortValue(a.lastActivity) ||
        a.room.localeCompare(b.room),
    );

    if (sortedRooms.length > 0) {
      console.log("\nChat rooms:");
      const toShow = Math.min(sortedRooms.length, options.roomLimit);
      for (const room of sortedRooms.slice(0, toShow)) {
        const last = formatTimeLine(room.lastActivity, now);
        const sessionsText = `${room.sessions} session${room.sessions === 1 ? "" : "s"}`;
        console.log(`  ${room.room}  ${room.messages} msgs, ${sessionsText} (last: ${last})`);
      }
      if (toShow < sortedRooms.length) {
        console.log(`  ... (+${sortedRooms.length - toShow} more, use --all or --rooms N)`);
      }
    } else {
      console.log("\nChat rooms: none");
    }
  } else {
    const fallbackEntries = Object.entries(state).sort((a, b) => a[0].localeCompare(b[0]));
    if (fallbackEntries.length > 0) {
      console.log("\nJobs (from state file):");
      for (const [name, info] of fallbackEntries) {
        const last = formatTimeLine(info.lastRun, now);
        const icon = info.status === "ok" ? ICON_PASS : info.status === "error" ? ICON_FAIL : "\u2217";
        console.log(`  ${icon} ${name}: ${info.status} (last: ${last}, ${formatDuration(info.duration_ms)})`);
      }
    } else if (dbError) {
      console.log(`\nJobs: database unavailable (${errMsg(dbError)})`);
    } else {
      console.log("\nJobs: none");
    }
  }

  if (dbError) {
    console.log("Tip: start with --json for machine-readable output.");
  } else {
    console.log("Tip: use --rooms N, --all, or --json for alternate views.");
  }

  // Check for updates (non-blocking, cached 24h)
  try {
    const { version } = await import("../../package.json");
    const update = await checkForUpdate(version);
    if (update) {
      console.log(`\n⚠ Update available: ${update.current} → ${update.latest} (run \`npm i -g niahere\` to update)`);
    }
  } catch {}
}
