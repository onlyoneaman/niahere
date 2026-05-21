import { readFileSync, existsSync } from "fs";
import { basename } from "path";
import { randomUUID } from "crypto";
import { Message, Session } from "../../db/models";
import { getConfig } from "../../utils/config";
import { getChannel } from "../../channels/registry";
import { log } from "../../utils/log";
import type { Recipient } from "../../types";
import type { McpSourceContext } from "../index";

/** Guess MIME type from file extension. */
export function guessMime(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase();
  const map: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
    txt: "text/plain",
    md: "text/markdown",
    csv: "text/csv",
    json: "application/json",
    pdf: "application/pdf",
    html: "text/html",
  };
  return map[ext || ""] || "application/octet-stream";
}

/** Send directly via API when no started channel is available (e.g. CLI `nia send`). */
async function sendDirect(target: string, text: string): Promise<void> {
  const config = getConfig();

  if (target === "telegram") {
    const token = config.channels.telegram.bot_token;
    const chatId = config.channels.telegram.chat_id;
    if (!token) throw new Error("Telegram not configured (no bot token)");
    if (!chatId) throw new Error("No Telegram chat ID — send a message to the bot first");
    const { Bot } = await import("grammy");
    const bot = new Bot(token);
    await bot.api.sendMessage(chatId, text);
    return;
  }

  if (target === "slack") {
    const token = config.channels.slack.bot_token;
    const recipient = config.channels.slack.dm_user_id;
    if (!token) throw new Error("Slack not configured (no bot token)");
    if (!recipient) throw new Error("No Slack recipient — set dm_user_id in config");
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
    const token = config.channels.telegram.bot_token;
    const chatId = config.channels.telegram.chat_id;
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
    const token = config.channels.slack.bot_token;
    const recipient = config.channels.slack.dm_user_id;
    if (!token) throw new Error("Slack not configured (no bot token)");
    if (!recipient) throw new Error("No Slack recipient — set dm_user_id in config");
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

export async function sendMessage(
  text: string,
  channelName?: string,
  mediaPath?: string,
  sourceCtx?: McpSourceContext,
  target: "auto" | "dm" | "thread" = "auto",
): Promise<string> {
  const config = getConfig();
  const channelTarget = channelName || config.channels.default;

  // Use started channel if available (daemon), otherwise call API directly (CLI)
  const channel = getChannel(channelTarget);

  // Resolve send target: thread reply vs DM
  // "auto" = if we have thread context, reply there; otherwise DM
  // "dm" = always DM the owner
  // "thread" = reply in current thread (falls back to DM if no thread context)
  const hasThreadCtx = sourceCtx?.slackChannelId && sourceCtx?.slackThreadTs;
  const useThread = (target === "auto" && hasThreadCtx) || (target === "thread" && hasThreadCtx);

  // Compute room prefix for DB storage BEFORE sending
  let roomPrefix: string | undefined;
  if (channelTarget === "telegram") {
    const chatId = config.channels.telegram.chat_id;
    if (chatId) roomPrefix = `tg-${chatId}`;
  } else if (channelTarget === "slack") {
    if (useThread && sourceCtx?.room) {
      // Replying in-thread: use the source session's room prefix
      roomPrefix = sourceCtx.room.replace(/-\d+$/, "");
    } else {
      const dmUserId = config.channels.slack.dm_user_id;
      if (dmUserId) {
        roomPrefix = `slack-dm-${dmUserId}`;
      }
    }
  }

  // Save pending notification to DB before sending (avoids race with fast replies)
  let messageId: number | undefined;
  if (roomPrefix) {
    try {
      const idx = await Session.getLatestRoomIndex(roomPrefix);
      const fullRoom = `${roomPrefix}-${idx}`;
      let sessionId = await Session.getLatest(fullRoom);

      // Auto-create a backing session if none exists (e.g. first proactive DM)
      if (!sessionId) {
        sessionId = randomUUID();
        await Session.create(sessionId, fullRoom);
      }

      const content = mediaPath ? `${text} [media: ${basename(mediaPath)}]` : text;
      const source = sourceCtx?.jobName ? `job:${sourceCtx.jobName}` : sourceCtx?.channel || undefined;
      const metadata: Record<string, unknown> = { kind: useThread ? "thread_reply" : "notification" };
      if (source) metadata.source = source;

      messageId = await Message.save({
        sessionId,
        room: fullRoom,
        sender: "nia",
        content,
        isFromAgent: true,
        deliveryStatus: "pending",
        metadata,
      });
    } catch (err) {
      log.warn({ err, channelTarget, roomPrefix }, "sendMessage: failed to save pending notification to DB");
    }
  }

  try {
    let media: { data: Uint8Array; mimeType: string; filename: string } | undefined;
    if (mediaPath) {
      if (!existsSync(mediaPath)) {
        if (messageId) await Message.updateDeliveryStatus(messageId, "failed").catch(() => {});
        return `Failed to send: file not found: ${mediaPath}`;
      }
      const buf = readFileSync(mediaPath);
      media = { data: new Uint8Array(buf), mimeType: guessMime(mediaPath), filename: basename(mediaPath) };
    }

    const recipient: Recipient = useThread
      ? { kind: "thread", channelId: sourceCtx!.slackChannelId!, threadTs: sourceCtx!.slackThreadTs }
      : { kind: "owner" };

    if (channel) {
      await channel.deliver({ text: text || undefined, media, to: recipient });
    } else {
      // No started channel in this process (e.g. CLI `nia send` outside the daemon).
      // Fall back to API-direct send — text-only, no thread fan-out.
      if (media) await sendMediaDirect(channelTarget, Buffer.from(media.data), media.mimeType, media.filename);
      if (text) await sendDirect(channelTarget, text);
    }

    // Mark as sent
    if (messageId) {
      await Message.updateDeliveryStatus(messageId, "sent").catch(() => {});
    }

    return mediaPath ? "Message with media sent." : "Message sent.";
  } catch (err) {
    if (messageId) await Message.updateDeliveryStatus(messageId, "failed").catch(() => {});
    const errText = err instanceof Error ? err.message : String(err);
    return `Failed to send: ${errText}`;
  }
}
