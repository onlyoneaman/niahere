import { Job, Message, Session } from "../db/models";
import { computeInitialNextRun } from "../core/scheduler";
import { getConfig } from "../utils/config";
import { sendToTelegram } from "../channels/telegram";
import { log } from "../utils/log";

export async function listJobs(): Promise<string> {
  const jobs = await Job.list();
  if (jobs.length === 0) return "No jobs found.";
  return JSON.stringify(jobs, null, 2);
}

export async function addJob(args: {
  name: string;
  schedule: string;
  prompt: string;
  schedule_type?: "cron" | "interval" | "once";
  always?: boolean;
}): Promise<string> {
  const scheduleType = args.schedule_type || "cron";
  const always = args.always || false;
  const config = getConfig();

  const nextRunAt = computeInitialNextRun(scheduleType, args.schedule, config.timezone);
  await Job.create(args.name, args.schedule, args.prompt, always, scheduleType, nextRunAt);
  return `Job "${args.name}" created (${scheduleType}: ${args.schedule}). Next run: ${nextRunAt.toISOString()}`;
}

export async function removeJob(name: string): Promise<string> {
  const removed = await Job.remove(name);
  return removed ? `Job "${name}" removed.` : `Job "${name}" not found.`;
}

export async function enableJob(name: string): Promise<string> {
  const updated = await Job.update(name, { enabled: true });
  if (!updated) return `Job "${name}" not found.`;

  const job = await Job.get(name);
  if (job) {
    const config = getConfig();
    const nextRun = computeInitialNextRun(job.scheduleType, job.schedule, config.timezone);
    const { getSql } = await import("../db/connection");
    await getSql()`UPDATE jobs SET next_run_at = ${nextRun} WHERE name = ${name}`;
  }
  return `Job "${name}" enabled.`;
}

export async function disableJob(name: string): Promise<string> {
  const updated = await Job.update(name, { enabled: false });
  return updated ? `Job "${name}" disabled.` : `Job "${name}" not found.`;
}

export async function runJobNow(name: string): Promise<string> {
  const job = await Job.get(name);
  if (!job) return `Job "${name}" not found.`;

  const { getSql } = await import("../db/connection");
  await getSql()`UPDATE jobs SET next_run_at = NOW() WHERE name = ${name}`;
  return `Job "${name}" queued for immediate execution.`;
}

export async function sendMessage(text: string, channel = "telegram"): Promise<string> {
  if (channel !== "telegram") return `Channel "${channel}" not supported yet.`;

  try {
    await sendToTelegram(text);

    // Store in messages table (best-effort)
    try {
      const config = getConfig();
      const chatId = config.telegram_chat_id;
      if (chatId) {
        const room = `tg-${chatId}`;
        const idx = await Session.getLatestRoomIndex(room);
        const fullRoom = `${room}-${idx}`;
        const sessionId = await Session.getLatest(fullRoom);
        if (sessionId) {
          await Message.save({
            sessionId,
            room: fullRoom,
            sender: "nia",
            content: text,
            isFromAgent: true,
          });
        }
      }
    } catch {}

    return "Message sent.";
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `Failed to send: ${msg}`;
  }
}

export async function listMessages(limit = 20, room?: string): Promise<string> {
  const messages = await Message.getRecent(limit, room);
  if (messages.length === 0) return "No messages found.";
  return JSON.stringify(messages, null, 2);
}
