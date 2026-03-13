import { readFileSync, existsSync } from "fs";
import { basename } from "path";
import { Job, Message, Session } from "../db/models";
import { computeInitialNextRun } from "../core/scheduler";
import { getConfig } from "../utils/config";
import { getChannel } from "../channels/registry";
import { log } from "../utils/log";
import { classifyMime } from "../types/attachment";

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

/** Guess MIME type from file extension. */
export function guessMime(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase();
  const map: Record<string, string> = {
    jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
    gif: "image/gif", webp: "image/webp",
    txt: "text/plain", md: "text/markdown", csv: "text/csv",
    json: "application/json", pdf: "application/pdf", html: "text/html",
  };
  return map[ext || ""] || "application/octet-stream";
}

/** Send directly via API when no started channel is available (e.g. CLI `nia send`). */
async function sendDirect(target: string, text: string): Promise<void> {
  const config = getConfig();

  if (target === "telegram") {
    const token = config.telegram_bot_token;
    const chatId = config.telegram_chat_id;
    if (!token) throw new Error("Telegram not configured (no bot token)");
    if (!chatId) throw new Error("No Telegram chat ID — send a message to the bot first");
    const { Bot } = await import("grammy");
    const bot = new Bot(token);
    await bot.api.sendMessage(chatId, text);
    return;
  }

  if (target === "slack") {
    const token = config.slack_bot_token;
    const recipient = config.slack_channel_id || config.slack_dm_user_id;
    if (!token) throw new Error("Slack not configured (no bot token)");
    if (!recipient) throw new Error("No Slack recipient — DM the bot first, or set slack_channel_id in config");
    const { App } = await import("@slack/bolt");
    const app = new App({ token, signingSecret: "unused" });
    await app.client.chat.postMessage({ token, channel: recipient, text });
    return;
  }

  throw new Error(`Channel "${target}" not configured`);
}

/** Send media directly via API (no started channel). */
async function sendMediaDirect(target: string, data: Buffer, mimeType: string, filename?: string): Promise<void> {
  const config = getConfig();

  if (target === "telegram") {
    const token = config.telegram_bot_token;
    const chatId = config.telegram_chat_id;
    if (!token) throw new Error("Telegram not configured (no bot token)");
    if (!chatId) throw new Error("No Telegram chat ID — send a message to the bot first");
    const { Bot, InputFile } = await import("grammy");
    const bot = new Bot(token);
    const file = new InputFile(data, filename);
    if (mimeType.startsWith("image/")) {
      await bot.api.sendPhoto(chatId, file);
    } else {
      await bot.api.sendDocument(chatId, file);
    }
    return;
  }

  if (target === "slack") {
    const token = config.slack_bot_token;
    const recipient = config.slack_channel_id || config.slack_dm_user_id;
    if (!token) throw new Error("Slack not configured (no bot token)");
    if (!recipient) throw new Error("No Slack recipient — DM the bot first, or set slack_channel_id in config");
    const { App } = await import("@slack/bolt");
    const app = new App({ token, signingSecret: "unused" });
    await app.client.filesUploadV2({
      channel_id: recipient,
      file: data,
      filename: filename || `file.${mimeType.split("/")[1] || "bin"}`,
    });
    return;
  }

  throw new Error(`Channel "${target}" not configured`);
}

export async function sendMessage(text: string, channelName?: string, mediaPath?: string): Promise<string> {
  const config = getConfig();
  const target = channelName || config.default_channel;

  // Use started channel if available (daemon), otherwise call API directly (CLI)
  const channel = getChannel(target);

  try {
    // Handle media attachment if provided
    if (mediaPath) {
      if (!existsSync(mediaPath)) return `Failed to send: file not found: ${mediaPath}`;
      const data = readFileSync(mediaPath);
      const mimeType = guessMime(mediaPath);
      const filename = basename(mediaPath);

      if (channel?.sendMedia) {
        await channel.sendMedia(data, mimeType, filename);
      } else {
        await sendMediaDirect(target, data, mimeType, filename);
      }

      // Also send text if provided (as a separate message)
      if (text) {
        if (channel?.sendMessage) {
          await channel.sendMessage(text);
        } else {
          await sendDirect(target, text);
        }
      }
    } else {
      if (channel?.sendMessage) {
        await channel.sendMessage(text);
      } else {
        await sendDirect(target, text);
      }
    }

    // Store in messages table (best-effort)
    try {
      let room: string | undefined;
      if (target === "telegram") {
        const chatId = config.telegram_chat_id;
        if (chatId) room = `tg-${chatId}`;
      } else if (target === "slack") {
        const channelId = config.slack_channel_id;
        if (channelId) room = `slack-${channelId}`;
      }

      if (room) {
        const idx = await Session.getLatestRoomIndex(room);
        const fullRoom = `${room}-${idx}`;
        const sessionId = await Session.getLatest(fullRoom);
        if (sessionId) {
          const content = mediaPath ? `${text} [media: ${basename(mediaPath)}]` : text;
          await Message.save({
            sessionId,
            room: fullRoom,
            sender: "nia",
            content,
            isFromAgent: true,
          });
        }
      }
    } catch {}

    return mediaPath ? "Message with media sent." : "Message sent.";
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
