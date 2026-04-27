import { App } from "@slack/bolt";
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from "fs";
import { join } from "path";
import { createHash } from "crypto";
import { createChatEngine } from "../chat/engine";
import type { Channel, ChatState, Attachment, AttachmentType } from "../types";
import { getConfig, updateRawConfig, resetConfig } from "../utils/config";
import { relativeTime } from "../utils/format";
import { runMigrations } from "../db/migrate";
import { Session, Message } from "../db/models";
import { log } from "../utils/log";
import { getMcpServers } from "../mcp";
import { getNiaHome, getPaths } from "../utils/paths";
import { classifyMime, validateAttachment, prepareImage } from "../utils/attachment";
import { resolveWatchBehavior } from "../utils/watches";

/** Strip markdown backticks so sentinel tokens like [NO_REPLY] match even when the LLM wraps them. */
function cleanSentinel(text: string): string {
  return text.replace(/`/g, "").trim();
}

class SlackChannel implements Channel {
  name = "slack";
  private app: App | null = null;
  private dmUserId: string | null = null;
  /** Timestamps of messages Nia posted proactively (used to detect replies to our own messages) */
  private outboundTs = new Set<string>();

  async sendMessage(text: string): Promise<void> {
    if (!this.app) throw new Error("Slack not started");
    const target = this.dmUserId;
    if (!target) throw new Error("No Slack recipient — set dm_user_id in config");
    const result = await this.app.client.chat.postMessage({ channel: target, text });
    if (result.ts) this.outboundTs.add(result.ts);
  }

  async sendToThread(channelId: string, text: string, threadTs?: string): Promise<void> {
    if (!this.app) throw new Error("Slack not started");
    const opts: Record<string, unknown> = { channel: channelId, text };
    if (threadTs) opts.thread_ts = threadTs;
    const result = await this.app.client.chat.postMessage(opts as any);
    if (result.ts) this.outboundTs.add(result.ts);
  }

  async sendMedia(data: Buffer, mimeType: string, filename?: string): Promise<void> {
    if (!this.app) throw new Error("Slack not started");
    const target = this.dmUserId;
    if (!target) throw new Error("No Slack recipient — set dm_user_id in config");
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

    interface SlackContext {
      slackChannelId?: string;
      slackThreadTs?: string;
    }

    async function getState(key: string, watchBehavior?: { channel: string; behavior: string }, slackCtx?: SlackContext): Promise<ChatState> {
      let state = chats.get(key);
      if (!state) {
        const prefix = roomPrefix(key);
        const idx = await Session.getLatestRoomIndex(prefix);
        const room = roomName(key, idx);
        const engine = await createChatEngine({
          room,
          channel: "slack",
          resume: true,
          mcpServers: getMcpServers({ channel: "slack", room, ...slackCtx }),
          watchBehavior,
        });
        state = { engine, roomIndex: idx, lock: Promise.resolve() };
        chats.set(key, state);
      }
      return state;
    }

    async function restartChat(key: string, watchBehavior?: { channel: string; behavior: string }, slackCtx?: SlackContext): Promise<ChatState> {
      const old = chats.get(key);
      if (old) old.engine.close();

      const prefix = roomPrefix(key);
      const prevIdx = await Session.getLatestRoomIndex(prefix);
      const newIdx = prevIdx + 1;
      const room = roomName(key, newIdx);

      // Persist a placeholder session immediately so the room index survives
      // daemon restarts (otherwise getState falls back to the old room).
      await Session.create(`placeholder-${room}`, room);

      log.info({ key, room }, "slack: creating chat engine");
      const engine = await createChatEngine({
        room,
        channel: "slack",
        resume: false,
        mcpServers: getMcpServers({ channel: "slack", room, ...slackCtx }),
        watchBehavior,
      });
      const state: ChatState = { engine, roomIndex: newIdx, lock: Promise.resolve() };
      chats.set(key, state);
      log.info({ key, room, activeSessions: chats.size }, "slack: engine ready");
      return state;
    }

    function withLock(key: string, fn: () => Promise<void>): void {
      const state = chats.get(key);
      if (!state) {
        fn().catch((err) => log.error({ err, key }, "unhandled error in locked handler"));
        return;
      }
      const queued = state.lock !== Promise.resolve();
      if (queued) log.debug({ key }, "slack: message queued behind active lock");
      state.lock = state.lock.then(fn, fn).catch((err) => log.error({ err, key }, "unhandled error in locked handler"));
    }

    const self = this;

    const app = new App({
      token: botToken,
      appToken,
      socketMode: true,
    });

    let botUserId: string | undefined;

    // Watch channels: mtime-based hot-reload from config.yaml AND any watch
    // behavior files referenced by that config. Keys are channel_id#channel_name.
    let watchCache: Map<string, { name: string; behavior: string }> = new Map();
    let watchFilePaths: string[] = [];
    let lastReloadMtime = 0;

    function maxMtime(paths: string[]): number {
      let max = 0;
      for (const p of paths) {
        try {
          const m = statSync(p).mtimeMs;
          if (m > max) max = m;
        } catch {
          // ignore missing files
        }
      }
      return max;
    }

    function reloadWatchChannels(): Map<string, { name: string; behavior: string }> {
      const configPath = getPaths().config;
      const mtime = maxMtime([configPath, ...watchFilePaths]);
      if (mtime === 0) return watchCache;
      if (mtime === lastReloadMtime) return watchCache;

      resetConfig(); // clear cached config so getConfig() re-reads from disk
      const cfg = getConfig();
      const watch = cfg.channels.slack.watch;
      const fresh = new Map<string, { name: string; behavior: string }>();
      const freshFiles: string[] = [];
      if (watch) {
        for (const [key, entry] of Object.entries(watch)) {
          if (!entry.enabled) continue;
          const hashIdx = key.indexOf("#");
          if (hashIdx === -1) {
            log.warn({ channel: key }, "slack: watch key must use channel_id#name format, skipping");
            continue;
          }
          const id = key.slice(0, hashIdx);
          const name = key.slice(hashIdx + 1);
          const resolved = resolveWatchBehavior(entry.behavior, name);
          if (resolved.filePath) freshFiles.push(resolved.filePath);
          fresh.set(id, { name, behavior: resolved.behavior });
        }
      }
      if (fresh.size !== watchCache.size) {
        log.info({ count: fresh.size }, "slack: watch channels reloaded");
      }
      watchCache = fresh;
      watchFilePaths = freshFiles;
      lastReloadMtime = maxMtime([configPath, ...freshFiles]);
      return watchCache;
    }

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
      log.info(
        { channel: command.channel_id, key, room: roomName(key, state.roomIndex) },
        "new slack session via /nia-new",
      );
      await respond("New conversation started.");
    });

    // Disk-backed file cache: download once, read from disk on subsequent requests
    const attachRoot = join(getNiaHome(), "tmp", "attachments");
    mkdirSync(attachRoot, { recursive: true });

    interface CachedFile {
      path: string;
      type: AttachmentType;
      mimeType: string;
      filename?: string;
    }
    const fileIndex = new Map<string, CachedFile>();

    function urlHash(url: string): string {
      return createHash("sha256").update(url).digest("hex").slice(0, 16);
    }

    function loadCached(entry: CachedFile): Attachment {
      return {
        type: entry.type,
        data: readFileSync(entry.path),
        mimeType: entry.mimeType,
        filename: entry.filename,
        sourcePath: entry.path,
      };
    }

    async function downloadSlackFile(url: string): Promise<Buffer> {
      const resp = await fetch(url, {
        headers: { Authorization: `Bearer ${botToken}` },
      });
      if (!resp.ok) throw new Error(`Slack file download failed: ${resp.status}`);
      return Buffer.from(await resp.arrayBuffer());
    }

    function cacheDirForScope(scope: string): string {
      const safeScope = scope.replace(/[^a-zA-Z0-9._-]/g, "_");
      const dir = join(attachRoot, safeScope);
      mkdirSync(dir, { recursive: true });
      return dir;
    }

    function cacheKey(scope: string, url: string): string {
      return `${scope}:${url}`;
    }

    function safeExtension(filename?: string): string {
      const ext = filename?.split(".").pop();
      return ext && /^[a-zA-Z0-9]{1,16}$/.test(ext) ? ext : "bin";
    }

    async function extractSlackAttachments(files: any[], scope: string): Promise<Attachment[]> {
      const attachments: Attachment[] = [];
      const scopedAttachDir = cacheDirForScope(scope);
      for (const file of files) {
        const mime = file.mimetype || "application/octet-stream";
        const attType = classifyMime(mime);
        if (!attType) continue;
        if (!file.url_private_download) continue;

        // Check in-memory index first
        const indexedKey = cacheKey(scope, file.url_private_download);
        const cached = fileIndex.get(indexedKey);
        if (cached && existsSync(cached.path)) {
          attachments.push(loadCached(cached));
          continue;
        }

        // Check disk (survives daemon restarts) — scoped by Slack room/thread.
        const hash = urlHash(file.url_private_download);
        const ext = safeExtension(file.name);
        const diskPath = join(scopedAttachDir, `${hash}.${ext}`);
        const metaPath = join(scopedAttachDir, `${hash}.meta.json`);
        if (existsSync(diskPath) && existsSync(metaPath)) {
          try {
            const meta = JSON.parse(readFileSync(metaPath, "utf8"));
            const entry: CachedFile = {
              path: diskPath,
              type: meta.type || attType,
              mimeType: meta.mimeType || mime,
              filename: meta.filename || file.name,
            };
            fileIndex.set(indexedKey, entry);
            attachments.push(loadCached(entry));
            continue;
          } catch {
            // Corrupt meta — re-download
          }
        }

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

          // Save file + metadata to disk
          writeFileSync(diskPath, finalData);
          writeFileSync(metaPath, JSON.stringify({ type: attType, mimeType: finalMime, filename: file.name }));
          const entry: CachedFile = { path: diskPath, type: attType, mimeType: finalMime, filename: file.name };
          fileIndex.set(indexedKey, entry);

          attachments.push({ type: attType, data: finalData, mimeType: finalMime, filename: file.name, sourcePath: diskPath });
        } catch (err) {
          log.warn({ err, file: file.name }, "failed to download slack file");
        }
      }
      return attachments;
    }

    // Handle messages (DMs + @mentions)
    app.message(async ({ message, say, client }) => {
      if (message.subtype && message.subtype !== "file_share") return;
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
              log.debug(
                { channel: msg.channel, thread_ts: msg.thread_ts },
                "thread parent is bot-authored, activating",
              );
            }
          } catch (err) {
            log.warn({ err, channel: msg.channel, thread_ts: msg.thread_ts }, "failed to check thread parent");
          }
        }
      }

      // Check if this is a watched channel (hot-reloads from config.yaml via mtime)
      const currentWatch = reloadWatchChannels();
      const watchConfig = currentWatch.get(msg.channel);
      const isWatched = !!watchConfig;

      if (!isDm && !isMention && !isActiveThread && !isWatched) {
        log.debug(
          {
            channel: msg.channel,
            text: (msg.text || "").slice(0, 80),
            thread_ts: msg.thread_ts,
            isDm,
            isMention: !!isMention,
            isActiveThread,
            activeChats: [...chats.keys()],
            reason: !msg.thread_ts ? "no mention in channel" : "no active session for thread",
          },
          "slack message ignored",
        );
        return;
      }

      // Strip the @mention
      let text = msg.text || "";
      if (botUserId) {
        text = text.replace(new RegExp(`<@${botUserId}>`, "g"), "").trim();
      }

      // Auto-register DM user for outbound messages
      if (isDm && !self.dmUserId && msg.user) {
        self.dmUserId = msg.user;
        updateRawConfig({ channels: { slack: { dm_user_id: msg.user } } });
        log.info({ userId: msg.user }, "auto-registered slack DM user");
      }

      // Build session key:
      // - DMs: flat by default, threaded if replying in a thread
      //   - Flat: slack-dm-{userId}
      //   - Threaded: slack-dm-{userId}-t{threadTs} (scoped to that thread)
      // - Channels: per-thread → slack-{channelName}-t{threadTs}
      //   - Top-level @mention starts a new thread (uses msg.ts as thread root)
      //   - Reply in thread continues that thread's session
      let key: string;
      let replyThreadTs: string | undefined;

      if (isDm) {
        if (msg.thread_ts) {
          // Thread reply in DM — scoped session for this thread
          key = `dm-${msg.user}-t${msg.thread_ts}`;
          replyThreadTs = msg.thread_ts;
        } else {
          key = `dm-${msg.user}`;
        }
      } else {
        const channelName = await resolveChannelName(app, msg.channel);
        const threadTs = msg.thread_ts || msg.ts; // existing thread or start new one
        key = `${channelName}-t${threadTs}`;
        replyThreadTs = threadTs;
      }

      // Download any file attachments
      let attachments: Attachment[] | undefined;
      if (hasFiles) {
        attachments = await extractSlackAttachments(msg.files!, roomPrefix(key));
      }

      if (!text && (!attachments || attachments.length === 0)) return;
      if (!text) text = attachments?.some((a) => a.type === "image") ? "What's in this image?" : "Here's a file.";

      // Prefix with user ID so the agent can reliably enforce owner checks in both channels and DMs.
      if (msg.user) {
        text = `[user:${msg.user}] ${text}`;
      }

      // When replying in a thread, fetch thread context so Nia can see the full conversation
      if (msg.thread_ts) {
        try {
          const replies = await client.conversations.replies({
            channel: msg.channel,
            ts: msg.thread_ts,
            limit: 50,
          });
          const priorMessages = (replies.messages || []).filter((m: any) => m.ts !== msg.ts); // exclude the triggering message

          const now = new Date();
          const threadMessages = priorMessages.map((m: any) => {
            const sender = m.bot_id ? "bot" : m.user || "unknown";
            const fileHint = m.files?.length ? ` [${m.files.length} file(s) attached]` : "";
            const age = m.ts ? ` (${relativeTime(new Date(parseFloat(m.ts) * 1000), now)})` : "";
            return `[${sender}]${age}: ${m.text || "(no text)"}${fileHint}`;
          });
          if (threadMessages.length > 0) {
            text = `[Thread context]\n${threadMessages.join("\n")}\n\n[Current message]\n${text}`;
          }

          // Download files from fetched thread messages.
          if (!attachments) attachments = [];
          const messagesWithFiles = priorMessages.filter((m: any) => m.files?.length > 0);
          let threadFilesAdded = 0;
          for (const m of messagesWithFiles) {
            const extracted = await extractSlackAttachments(m.files || [], roomPrefix(key));
            for (const att of extracted) {
              attachments.push(att);
              threadFilesAdded++;
            }
          }
          if (threadFilesAdded > 0) {
            log.info({ threadFiles: threadFilesAdded, channel: msg.channel }, "slack: downloaded thread attachments");
          }
        } catch (err) {
          log.warn({ err, channel: msg.channel, thread_ts: msg.thread_ts }, "failed to fetch thread context");
        }
      }

      // Build watch behavior for system prompt injection (if watched channel)
      const watchBehavior = watchConfig?.behavior
        ? { channel: watchConfig.name, behavior: watchConfig.behavior }
        : undefined;

      log.info(
        {
          channel: msg.channel,
          key,
          text: text.slice(0, 100),
          isDm,
          watched: isWatched,
          attachments: attachments?.length || 0,
        },
        "slack message received",
      );

      let state: ChatState;
      const slackCtx: SlackContext = {
        slackChannelId: msg.channel,
        slackThreadTs: replyThreadTs,
      };
      try {
        state = await getState(key, watchBehavior, slackCtx);
      } catch (err) {
        log.error({ err, key }, "slack: failed to create chat engine");
        return;
      }

      withLock(key, async () => {
        // For flat DM messages (no thread), prepend recent notifications so
        // the bot knows what jobs/watches recently sent to this user.
        if (isDm && !msg.thread_ts) {
          try {
            const dmPrefix = `slack-dm-${msg.user}`;
            const notifications = await Message.getRecentNotifications(dmPrefix);
            if (notifications.length > 0) {
              const lines = notifications.map((n) => {
                const ago = relativeTime(new Date(n.createdAt), new Date());
                const src = n.source ? ` via ${n.source}` : "";
                return `- (${ago}${src}): ${n.content}`;
              });
              text = `[Recent notifications you sent to the user]\n${lines.join("\n")}\n\n[Current message]\n${text}`;
            }
          } catch (err) {
            log.warn({ err }, "slack: failed to load recent notifications for DM context");
          }
        }

        // Add thinking reaction inside the lock so cleanup is guaranteed
        await client.reactions
          .add({ channel: msg.channel, timestamp: msg.ts, name: "thinking_face" })
          .catch((err) => log.debug({ err, channel: msg.channel }, "slack: failed to add thinking reaction"));

        try {
          const { result, messageId } = await state.engine.send(
            text,
            {
              onActivity(status) {
                log.debug({ status }, "slack engine activity");
              },
            },
            attachments,
          );

          const reply = result.trim();

          // [NO_REPLY] or empty = agent chose not to respond (thread judgement)
          if (!reply || cleanSentinel(reply) === "[NO_REPLY]") {
            log.info({ channel: msg.channel, key }, "slack: agent chose not to reply");
            if (messageId) await Message.updateDeliveryStatus(messageId, "sent").catch(() => {});
            return;
          }

          try {
            if (replyThreadTs) {
              await client.chat.postMessage({
                channel: msg.channel,
                text: reply,
                thread_ts: replyThreadTs,
              });
            } else {
              await say(reply);
            }
            if (messageId) await Message.updateDeliveryStatus(messageId, "sent").catch(() => {});
            log.info({ channel: msg.channel, key, chars: reply.length }, "slack reply sent");
          } catch (sendErr) {
            if (messageId) await Message.updateDeliveryStatus(messageId, "failed").catch(() => {});
            throw sendErr;
          }
        } catch (err) {
          const errText = err instanceof Error ? err.message : String(err);
          log.error({ err, channel: msg.channel }, "slack message processing failed");

          if (replyThreadTs) {
            await client.chat
              .postMessage({
                channel: msg.channel,
                text: `[error] ${errText}`,
                thread_ts: replyThreadTs,
              })
              .catch(() => {});
          } else {
            await say(`[error] ${errText}`).catch(() => {});
          }
        } finally {
          await client.reactions
            .remove({ channel: msg.channel, timestamp: msg.ts, name: "thinking_face" })
            .catch((err) => log.debug({ err, channel: msg.channel }, "slack: failed to remove thinking reaction"));
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

    // Initial watch channel load
    reloadWatchChannels();

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
