import { App } from "@slack/bolt";
import type { Channel, ChatState, Attachment, Outbound, Recipient } from "../types";
import { getConfig, updateRawConfig } from "../utils/config";
import { relativeTime } from "../utils/format";
import { runMigrations } from "../db/migrate";
import { Session, Message } from "../db/models";
import { log } from "../utils/log";
import { getMcpServers } from "../mcp";
import { chainLock, openChatEngine, rotateRoom } from "./common/chat-session";
import { SlackAttachmentCache } from "./slack/attachments";
import { SlackWatchReloader } from "./slack/watch";

/** Strip markdown backticks so sentinel tokens like [NO_REPLY] match even when the LLM wraps them. */
function cleanSentinel(text: string): string {
  return text.replace(/`/g, "").trim();
}

class SlackChannel implements Channel {
  name = "slack" as const;
  private app: App | null = null;
  private dmUserId: string | null = null;
  /** Timestamps of messages Nia posted proactively (used to detect replies to our own messages) */
  private outboundTs = new Set<string>();

  async deliver(out: Outbound): Promise<void> {
    if (!this.app) throw new Error("Slack not started");
    const dest = this.resolveDest(out.to);

    if (out.media) {
      const buffer = Buffer.from(out.media.data);
      const filename = out.media.filename || `file.${out.media.mimeType.split("/")[1] || "bin"}`;
      await this.app.client.filesUploadV2({
        channel_id: dest.channel,
        file: buffer,
        filename,
        ...(dest.threadTs ? { thread_ts: dest.threadTs } : {}),
      } as any);
    }

    if (out.text) {
      const opts: Record<string, unknown> = { channel: dest.channel, text: out.text };
      if (dest.threadTs) opts.thread_ts = dest.threadTs;
      const result = await this.app.client.chat.postMessage(opts as any);
      if (result.ts) this.outboundTs.add(result.ts);
    }
  }

  private resolveDest(to: Recipient | undefined): { channel: string; threadTs?: string } {
    if (to?.kind === "thread") return { channel: to.channelId, threadTs: to.threadTs };
    if (!this.dmUserId) throw new Error("No Slack recipient — set dm_user_id in config");
    return { channel: this.dmUserId };
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

    interface SlackContext {
      slackChannelId?: string;
      slackThreadTs?: string;
    }

    function roomPrefix(k: string): string {
      return `slack-${k}`;
    }

    function roomName(k: string, index: number): string {
      return `slack-${k}-${index}`;
    }

    function buildEngineOpts(watchBehavior?: { channel: string; behavior: string }, slackCtx?: SlackContext) {
      return (room: string) => ({
        channel: "slack",
        mcpServers: getMcpServers({ channel: "slack", room, ...slackCtx }),
        watchBehavior,
      });
    }

    async function getState(
      key: string,
      watchBehavior?: { channel: string; behavior: string },
      slackCtx?: SlackContext,
    ): Promise<ChatState> {
      let state = chats.get(key);
      if (state) return state;
      state = await openChatEngine(roomPrefix(key), buildEngineOpts(watchBehavior, slackCtx));
      chats.set(key, state);
      return state;
    }

    async function restartChat(
      key: string,
      watchBehavior?: { channel: string; behavior: string },
      slackCtx?: SlackContext,
    ): Promise<ChatState> {
      const state = await rotateRoom(roomPrefix(key), chats.get(key), buildEngineOpts(watchBehavior, slackCtx));
      chats.set(key, state);
      return state;
    }

    function withLock(key: string, fn: () => Promise<void>): void {
      const state = chats.get(key);
      if (!state) {
        fn().catch((err) => log.error({ err, key }, "unhandled error in locked handler"));
        return;
      }
      chainLock(state, fn);
    }

    const self = this;

    const app = new App({
      token: botToken,
      appToken,
      socketMode: true,
    });

    let botUserId: string | undefined;
    let botId: string | undefined;

    const watchReloader = new SlackWatchReloader();
    const attachmentCache = new SlackAttachmentCache(botToken);

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
            if (parentMsg && (parentMsg.user === botUserId || (botId && parentMsg.bot_id === botId))) {
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
      const currentWatch = watchReloader.reload();
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
        attachments = await attachmentCache.extract(msg.files!, roomPrefix(key));
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
            const extracted = await attachmentCache.extract(m.files || [], roomPrefix(key));
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
          const cleaned = cleanSentinel(reply);

          // [NO_REPLY] anywhere in the reply suppresses the send. If it appeared
          // alongside real content the model got confused — warn so we can spot it.
          if (!reply || cleaned.includes("[NO_REPLY]")) {
            const exact = !reply || cleaned === "[NO_REPLY]";
            if (exact) {
              log.info({ channel: msg.channel, key }, "slack: agent chose not to reply");
            } else {
              log.warn(
                { channel: msg.channel, key, reply },
                "slack: [NO_REPLY] sentinel mixed with content; suppressing send",
              );
            }
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
      botId = auth.bot_id as string | undefined;
      log.info({ botUserId, botId }, "slack bot authenticated");
    } catch (err) {
      log.warn({ err }, "could not get slack bot user ID");
    }

    // Initial watch channel load
    watchReloader.reload();

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
  if (!config.channels.slack.enabled || !config.channels.slack.bot_token || !config.channels.slack.app_token) {
    return null;
  }
  return new SlackChannel();
}
