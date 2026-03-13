import { isRunning, readPid } from "../core/daemon";
import { readState } from "../utils/logger";
import { getConfig } from "../utils/config";
import { localTime } from "../utils/time";
import { Message, ActiveEngine, Job } from "../db/models";
import { withDb } from "../db/connection";

export async function statusCommand(): Promise<void> {
  const running = isRunning();
  const pid = readPid();
  console.log(`nia: ${running ? `running (pid: ${pid})` : "stopped"}`);

  const config = getConfig();
  if (config.telegram_bot_token) {
    const masked = `...${config.telegram_bot_token.slice(-6)}`;
    console.log(`telegram: ${running ? `active (${masked})` : `configured (${masked}, daemon stopped)`}`);
  } else {
    console.log("telegram: not configured");
  }

  if (config.slack_bot_token) {
    const masked = `...${config.slack_bot_token.slice(-6)}`;
    console.log(`slack: ${running ? `active (${masked})` : `configured (${masked}, daemon stopped)`}`);
  } else {
    console.log("slack: not configured");
  }

  if (config.default_channel !== "telegram") {
    console.log(`default channel: ${config.default_channel}`);
  }

  try {
    await withDb(async () => {
      const jobs = await Job.list();
      if (jobs.length > 0) {
        console.log("\nJobs:");
        const state = readState();
        for (const job of jobs) {
          const info = state[job.name];
          const status = info ? `${info.status} (last: ${localTime(new Date(info.lastRun))}, ${info.duration_ms}ms)` : "never run";
          console.log(`  ${job.name}: ${job.enabled ? "enabled" : "disabled"} [${job.schedule}] — ${status}`);
        }
      }

      const engines = await ActiveEngine.list();
      console.log(`\nActive engines: ${engines.length === 0 ? "none" : ""}`);
      for (const e of engines) {
        console.log(`  ${e.room} (${e.channel}) since ${localTime(new Date(e.startedAt))}`);
      }

      const rooms = await Message.getRoomStats();
      if (rooms.length > 0) {
        console.log("\nChat rooms:");
        for (const r of rooms) {
          const last = r.lastActivity ? localTime(new Date(r.lastActivity)) : "never";
          console.log(`  ${r.room}: ${r.messages} msgs, ${r.sessions} session${r.sessions !== 1 ? "s" : ""} (last: ${last})`);
        }
      }
    });
  } catch {
    const state = readState();
    const entries = Object.entries(state);
    if (entries.length > 0) {
      console.log("\nJobs (from state file):");
      for (const [name, info] of entries) {
        console.log(`  ${name}: ${info.status} (last: ${localTime(new Date(info.lastRun))}, ${info.duration_ms}ms)`);
      }
    }
  }
}
