import { App } from "@slack/bolt";
import { createChatEngine } from "../chat/engine";
import type { Channel, ChatState, Attachment } from "../types";
import { getConfig, updateRawConfig } from "../utils/config";
import { runMigrations } from "../db/migrate";
import { Session } from "../db/models";
import { log } from "../utils/log";
import { getMcpServers } from "../mcp";
import { classifyMime, validateAttachment, prepareImage } from "../utils/attachment";

class SlackChannel implements Channel {
  name = "slack";
  private app: App | null = null;
  private defaultChannelId: string | null = null;
  private dmUserId: string | null = null;
  /** Timestamps of messages Nia posted proactively (used to detect replies to our own messages) */
  private outboundTs = new Set<string>();

  async sendMessage(text: string): Promise<void> {
    if (!this.app) throw new Error("Slack not started");
    const target = this.defaultChannelId || this.dmUserId;
    if (!target) throw new Error("No Slack recipient — DM the bot first, or set slack_channel_id in config");
    const result = await this.app.client.chat.postMessage({ channel: target, text });
    if (result.ts) this.outboundTs.add(result.ts);
  }

  async sendMedia(data: Buffer, mimeType: string, filename?: string): Promise<void> {
    if (!this.app) throw new Error("Slack not started");
    const target = this.defaultChannelId || this.dmUserId;
    if (!target) throw new Error("No Slack recipient — DM the bot first, or set slack_channel_id in config");
    await this.app.client.filesUploadV2({
      channel_id: target,
      file: data,
      filename: filename || `file.${mimeType.split("/")[1] || "bin"}`,
    });
  }

  async start(): Promise<void> {
    const config = getConfig();
    const botToken = config.channels.slack.bot_token!;
    const appToken = config.channels.slack.app_token!;

    await runMigrations();

    this.defaultChannelId = config.channels.slack.channel_id;
    this.dmUserId = config.channels.slack.dm_user_id;

    const chats = new Map<string, ChatState>();
    const channelNames = new Map<string, string>();

    async function resolveChannelName(app: App, channelId: string): Promise<string> {
      const cached = channelNames.get(channelId);
      if (cached) return cached;
      let name = channelId;
      try {
        const info = await app.client.conversations.info({ channel: channelId });
        name = (info.channel as any)?.name || channelId;
      } catch {}
      channelNames.set(channelId, name);
      return name;
    }

    function roomPrefix(key: string): string {
      return `slack-${key}`;
    }

    function roomName(key: string, index: number): string {
      return `slack-${key}-${index}`;
    }

    async function getState(key: string): Promise<ChatState> {
      let state = chats.get(key);
      if (!state) {
        const prefix = roomPrefix(key);
        const idx = await Session.getLatestRoomIndex(prefix);
        const room = roomName(key, idx);
        const engine = await createChatEngine({ room, channel: "slack", resume: true, mcpServers: getMcpServers() });
        state = { engine, roomIndex: idx, lock: Promise.resolve() };
        chats.set(key, state);
      }
      return state;
    }

    async function restartChat(key: string): Promise<ChatState> {
      const old = chats.get(key);
      if (old) old.engine.close();

      const prefix = roomPrefix(key);
      const prevIdx = await Session.getLatestRoomIndex(prefix);
      const newIdx = prevIdx + 1;
      const room = roomName(key, newIdx);

      // Persist a placeholder session immediately so the room index survives
      // daemon restarts (otherwise getState falls back to the old room).
      await Session.create(`placeholder-${room}`, room);

      const engine = await createChatEngine({ room, channel: "slack", resume: false, mcpServers: getMcpServers() });
      const state: ChatState = { engine, roomIndex: newIdx, lock: Promise.resolve() };
      chats.set(key, state);
      return state;
    }

    function withLock(key: string, fn: () => Promise<void>): void {
      const state = chats.get(key);
      if (!state) {
        fn().catch((err) => log.error({ err, key }, "unhandled error in locked handler"));
        return;
      }
      state.lock = state.lock.then(fn, fn);
    }

    const self = this;

    const app = new App({
      token: botToken,
      appToken,
      socketMode: true,
    });

    let botUserId: string | undefined;

    // Slash command: /nia
    app.command("/nia", async ({ command, ack, respond }) => {
      await ack();

      const subcommand = command.text.trim().toLowerCase();
      const isDm = command.channel_name === "directmessage";
      const channelName = isDm ? `dm-${command.user_id}` : await resolveChannelName(app, command.channel_id);
      // For slash commands in channels, reset the whole channel DM-style (no thread context)
      const key = isDm ? channelName : channelName;

      if (subcommand === "new" || subcommand === "start") {
        const state = await restartChat(key);
        log.info({ channel: command.channel_id, key, room: roomName(key, state.roomIndex) }, "new slack session");
        await respond("New conversation started.");
      } else if (subcommand === "" || subcommand === "help") {
        await respond("Commands:\n• `/nia new` — start a new conversation\n• `/nia help` — show this help");
      } else {
        const state = await getState(key);
        withLock(key, async () => {
          try {
            const { result } = await state.engine.send(subcommand, {
              onActivity(status) {
                log.debug({ status }, "slack engine activity");
              },
            });
            await respond(result.trim() || "(no response)");
          } catch (err) {
            const errText = err instanceof Error ? err.message : String(err);
            await respond(`[error] ${errText}`);
          }
        });
      }
    });

    // Slash command: /nia-new — quick shortcut to start a fresh conversation
    app.command("/nia-new", async ({ command, ack, respond }) => {
      await ack();
      const isDm = command.channel_name === "directmessage";
      const key = isDm ? `dm-${command.user_id}` : await resolveChannelName(app, command.channel_id);
      const state = await restartChat(key);
      log.info({ channel: command.channel_id, key, room: roomName(key, state.roomIndex) }, "new slack session via /nia-new");
      await respond("New conversation started.");
    });

    async function downloadSlackFile(url: string): Promise<Buffer> {
      const resp = await fetch(url, {
        headers: { Authorization: `Bearer ${botToken}` },
      });
      if (!resp.ok) throw new Error(`Slack file download failed: ${resp.status}`);
      return Buffer.from(await resp.arrayBuffer());
    }

    async function extractSlackAttachments(files: any[]): Promise<Attachment[]> {
      const attachments: Attachment[] = [];
      for (const file of files.slice(0, 5)) {
        const mime = file.mimetype || "application/octet-stream";
        const attType = classifyMime(mime);
        if (!attType) continue;
        if (!file.url_private_download) continue;
        try {
          const data = await downloadSlackFile(file.url_private_download);
          const error = validateAttachment(data, mime);
          if (error) {
            log.warn({ file: file.name, error }, "skipping slack attachment");
            continue;
          }
          let finalData = data;
          let finalMime = mime;
          if (attType === "image") {
            const prepared = await prepareImage(data, mime);
            finalData = prepared.data;
            finalMime = prepared.mimeType;
          }
          attachments.push({ type: attType, data: finalData, mimeType: finalMime, filename: file.name });
        } catch (err) {
          log.warn({ err, file: file.name }, "failed to download slack file");
        }
      }
      return attachments;
    }

    // Handle messages (DMs + @mentions)
    app.message(async ({ message, say, client }) => {
      if (message.subtype) return;
      const msg = message as {
        text?: string;
        channel: string;
        channel_type?: string;
        user?: string;
        ts: string;
        thread_ts?: string;
        files?: any[];
      };
      if (!msg.user) return;
      if (!msg.text && (!msg.files || msg.files.length === 0)) return;

      const isDm = msg.channel_type === "im";
      const isMention = botUserId && msg.text?.includes(`<@${botUserId}>`);
      const hasFiles = msg.files && msg.files.length > 0;

      // In threads where Nia already has a session (in-memory or DB), listen without @mention.
      // Also catches replies to messages Nia posted proactively (outbound tracking + bot-authored fallback).
      let isActiveThread = false;
      if (!isDm && msg.thread_ts) {
        const channelName = await resolveChannelName(app, msg.channel);
        const threadKey = `${channelName}-t${msg.thread_ts}`;
        if (chats.has(threadKey)) {
          isActiveThread = true;
        } else {
          // Check DB for a persisted session from a previous daemon run
          const prefix = roomPrefix(threadKey);
          const latestRoom = roomName(threadKey, await Session.getLatestRoomIndex(prefix));
          const sessionId = await Session.getLatest(latestRoom);
          isActiveThread = sessionId !== null;
        }

        // Fast path: we tracked this ts when we sent it
        if (!isActiveThread && self.outboundTs.has(msg.thread_ts)) {
          isActiveThread = true;
        }

        // Fallback: check if the thread parent was posted by the bot
        if (!isActiveThread && botUserId) {
          try {
            const parent = await client.conversations.replies({
              channel: msg.channel,
              ts: msg.thread_ts,
              limit: 1,
              inclusive: true,
            });
            const parentMsg = parent.messages?.[0];
            if (parentMsg && (parentMsg.user === botUserId || parentMsg.bot_id)) {
              isActiveThread = true;
              log.debug({ channel: msg.channel, thread_ts: msg.thread_ts }, "thread parent is bot-authored, activating");
            }
          } catch (err) {
            log.warn({ err, channel: msg.channel, thread_ts: msg.thread_ts }, "failed to check thread parent");
          }
        }
      }

      if (!isDm && !isMention && !isActiveThread) {
        log.debug({
          channel: msg.channel,
          text: (msg.text || "").slice(0, 80),
          thread_ts: msg.thread_ts,
          isDm,
          isMention: !!isMention,
          isActiveThread,
          activeChats: [...chats.keys()],
          reason: !msg.thread_ts ? "no mention in channel" : "no active session for thread",
        }, "slack message ignored");
        return;
      }

      // Strip the @mention
      let text = msg.text || "";
      if (botUserId) {
        text = text.replace(new RegExp(`<@${botUserId}>`, "g"), "").trim();
      }

      // Prefix with user ID so the agent knows who's talking
      if (!isDm && msg.user) {
        text = `[user:${msg.user}] ${text}`;
      }

      // Download any file attachments
      let attachments: Attachment[] | undefined;
      if (hasFiles) {
        attachments = await extractSlackAttachments(msg.files!);
      }

      if (!text && (!attachments || attachments.length === 0)) return;
      if (!text) text = attachments?.some(a => a.type === "image") ? "What's in this image?" : "Here's a file.";

      // Auto-register DM user for outbound messages
      if (isDm && !self.dmUserId && msg.user) {
        self.dmUserId = msg.user;
        updateRawConfig({ channels: { slack: { dm_user_id: msg.user } } });
        log.info({ userId: msg.user }, "auto-registered slack DM user");
      }

      // Build session key:
      // - DMs: flat, one session per user → slack-dm-{userId}
      // - Channels: per-thread → slack-{channelName}-t{threadTs}
      //   - Top-level @mention starts a new thread (uses msg.ts as thread root)
      //   - Reply in thread continues that thread's session
      let key: string;
      let replyThreadTs: string | undefined;

      if (isDm) {
        key = `dm-${msg.user}`;
        // DMs stay flat, no threading
      } else {
        const channelName = await resolveChannelName(app, msg.channel);
        const threadTs = msg.thread_ts || msg.ts; // existing thread or start new one
        key = `${channelName}-t${threadTs}`;
        replyThreadTs = threadTs;
      }

      // When replying in a thread, fetch thread context so Nia can see the full conversation
      if (msg.thread_ts) {
        try {
          const replies = await client.conversations.replies({
            channel: msg.channel,
            ts: msg.thread_ts,
            limit: 20,
          });
          const threadMessages = (replies.messages || [])
            .filter((m: any) => m.ts !== msg.ts) // exclude the triggering message
            .map((m: any) => {
              const sender = m.bot_id ? "bot" : (m.user || "unknown");
              return `[${sender}]: ${m.text || "(no text)"}`;
            });
          if (threadMessages.length > 0) {
            text = `[Thread context]\n${threadMessages.join("\n")}\n\n[Current message]\n${text}`;
          }
        } catch (err) {
          log.warn({ err, channel: msg.channel, thread_ts: msg.thread_ts }, "failed to fetch thread context");
        }
      }

      log.info({ channel: msg.channel, key, text: text.slice(0, 100), isDm, attachments: attachments?.length || 0 }, "slack message received");

      const state = await getState(key);

      // Add thinking reaction while processing
      await client.reactions.add({ channel: msg.channel, timestamp: msg.ts, name: "thinking_face" }).catch(() => {});

      withLock(key, async () => {
        try {
          const { result } = await state.engine.send(text, {
            onActivity(status) {
              log.debug({ status }, "slack engine activity");
            },
          }, attachments);

          await client.reactions.remove({ channel: msg.channel, timestamp: msg.ts, name: "thinking_face" }).catch(() => {});

          const reply = result.trim();

          // [NO_REPLY] or empty = agent chose not to respond (thread judgement)
          if (!reply || reply === "[NO_REPLY]") {
            log.info({ channel: msg.channel, key }, "slack: agent chose not to reply");
            return;
          }

          if (replyThreadTs) {
            await client.chat.postMessage({
              channel: msg.channel,
              text: reply,
              thread_ts: replyThreadTs,
            });
          } else {
            await say(reply);
          }

          log.info({ channel: msg.channel, key, chars: reply.length }, "slack reply sent");
        } catch (err) {
          await client.reactions.remove({ channel: msg.channel, timestamp: msg.ts, name: "thinking_face" }).catch(() => {});

          const errText = err instanceof Error ? err.message : String(err);
          log.error({ err, channel: msg.channel }, "slack message processing failed");

          if (replyThreadTs) {
            await client.chat.postMessage({
              channel: msg.channel,
              text: `[error] ${errText}`,
              thread_ts: replyThreadTs,
            }).catch(() => {});
          } else {
            await say(`[error] ${errText}`);
          }
        }
      });
    });

    await app.start();

    // Get bot user ID for @mention detection
    try {
      const auth = await app.client.auth.test();
      botUserId = auth.user_id as string | undefined;
      log.info({ botUserId }, "slack bot authenticated");
    } catch (err) {
      log.warn({ err }, "could not get slack bot user ID");
    }

    log.info("slack bot started (Socket Mode)");
    this.app = app;
  }

  async stop(): Promise<void> {
    if (this.app) {
      await this.app.stop();
      this.app = null;
    }
  }
}

export function createSlackChannel(): SlackChannel | null {
  const config = getConfig();
  if (!config.channels.slack.bot_token || !config.channels.slack.app_token) return null;
  return new SlackChannel();
}
