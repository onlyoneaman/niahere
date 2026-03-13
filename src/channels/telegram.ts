import { Bot } from "grammy";
import type { Channel } from "./channel";
import { registerChannel } from "./index";
import { createChatEngine, type ChatEngine } from "../chat/engine";
import { getConfig } from "../utils/config";
import { updateRawConfig } from "../utils/config";
import { runMigrations } from "../db/migrate";
import { Session } from "../db/models";
import { log } from "../utils/log";

interface ChatState {
  engine: ChatEngine;
  roomIndex: number;
  lock: Promise<void>;
}

const STREAM_EDIT_INTERVAL = 2000; // min ms between edits (Telegram rate limit)

class TelegramChannel implements Channel {
  name = "telegram";
  private bot: Bot | null = null;

  async start(): Promise<void> {
    const config = getConfig();
    const token = config.telegram_bot_token!;

    await runMigrations();

    let outboundChatId = config.telegram_chat_id;

    const chats = new Map<number, ChatState>();

    function roomPrefix(chatId: number): string {
      return `tg-${chatId}`;
    }

    function roomName(chatId: number, index: number): string {
      return `tg-${chatId}-${index}`;
    }

    async function getState(chatId: number): Promise<ChatState> {
      let state = chats.get(chatId);
      if (!state) {
        const prefix = roomPrefix(chatId);
        const idx = await Session.getLatestRoomIndex(prefix);
        const room = roomName(chatId, idx);
        const engine = await createChatEngine({ room, channel: "telegram", resume: true });
        state = { engine, roomIndex: idx, lock: Promise.resolve() };
        chats.set(chatId, state);
      }
      return state;
    }

    async function restartChat(chatId: number): Promise<ChatState> {
      const old = chats.get(chatId);
      if (old) old.engine.close();

      const prefix = roomPrefix(chatId);
      const prevIdx = await Session.getLatestRoomIndex(prefix);
      const newIdx = prevIdx + 1;
      const room = roomName(chatId, newIdx);
      const engine = await createChatEngine({ room, channel: "telegram", resume: false });
      const state: ChatState = { engine, roomIndex: newIdx, lock: Promise.resolve() };
      chats.set(chatId, state);
      return state;
    }

    function withLock(chatId: number, fn: () => Promise<void>): void {
      const state = chats.get(chatId);
      if (!state) {
        fn().catch((err) => log.error({ err, chatId }, "unhandled error in locked handler"));
        return;
      }
      state.lock = state.lock.then(fn, fn);
    }

    function registerOutbound(chatId: number): void {
      if (outboundChatId) return;
      outboundChatId = chatId;
      updateRawConfig({ telegram_chat_id: chatId });
      log.info({ chatId }, "auto-registered outbound chat ID");
    }

    const bot = new Bot(token);

    async function processMessage(ctx: any, state: ChatState, text: string): Promise<void> {
      const chatId = ctx.chatId;
      log.info({ chatId, text: text.slice(0, 100) }, "telegram message received");

      // Show typing indicator throughout
      const typingInterval = setInterval(() => {
        bot.api.sendChatAction(chatId, "typing").catch(() => {});
      }, 4000);
      bot.api.sendChatAction(chatId, "typing").catch(() => {});

      let messageId: number | null = null;
      let sendingFirst = false;
      let lastEditedText = "";
      let lastEditTime = 0;
      let pendingEdit: string | null = null;
      let editTimer: ReturnType<typeof setTimeout> | null = null;

      async function scheduleEdit(newText: string): Promise<void> {
        const display = newText.length > 4000 ? newText.slice(-4000) + "..." : newText;
        if (display === lastEditedText) return;

        // Send first message on first stream content
        if (!messageId) {
          if (sendingFirst) {
            pendingEdit = display;
            return;
          }
          sendingFirst = true;
          try {
            const msg = await bot.api.sendMessage(chatId, display);
            messageId = msg.message_id;
            lastEditedText = display;
            lastEditTime = Date.now();
            // Flush any content that arrived while sending
            if (pendingEdit && pendingEdit !== display) {
              doEdit();
            }
          } catch { /* ignore */ }
          return;
        }

        pendingEdit = display;
        const now = Date.now();
        const elapsed = now - lastEditTime;

        if (elapsed >= STREAM_EDIT_INTERVAL && !editTimer) {
          doEdit();
        } else if (!editTimer) {
          editTimer = setTimeout(doEdit, STREAM_EDIT_INTERVAL - elapsed);
        }
      }

      function doEdit(): void {
        editTimer = null;
        if (!pendingEdit || pendingEdit === lastEditedText || !messageId) return;

        const text = pendingEdit;
        pendingEdit = null;
        lastEditedText = text;
        lastEditTime = Date.now();

        bot.api.editMessageText(chatId, messageId, text).catch(() => {});
      }

      try {
        const { result } = await state.engine.send(text, {
          onStream(textSoFar) {
            const trimmed = textSoFar.trim();
            if (trimmed) scheduleEdit(trimmed);
          },
        });

        clearInterval(typingInterval);

        if (editTimer) {
          clearTimeout(editTimer);
          editTimer = null;
        }

        const reply = result.trim() || "(no response)";
        if (messageId) {
          try {
            await bot.api.editMessageText(chatId, messageId, reply, { parse_mode: "MarkdownV2" });
          } catch {
            await bot.api.editMessageText(chatId, messageId, reply).catch(() => {});
          }
        } else {
          try {
            await bot.api.sendMessage(chatId, reply, { parse_mode: "MarkdownV2" });
          } catch {
            await bot.api.sendMessage(chatId, reply).catch(() => {});
          }
        }

        log.info({ chatId, chars: result.length }, "telegram reply sent");
      } catch (err) {
        clearInterval(typingInterval);

        if (editTimer) {
          clearTimeout(editTimer);
          editTimer = null;
        }

        const errText = err instanceof Error ? err.message : String(err);
        log.error({ err, chatId }, "telegram message processing failed");
        const errorReply = `[error] ${errText}`;
        if (messageId) {
          await bot.api.editMessageText(chatId, messageId, errorReply).catch(() => {});
        } else {
          await bot.api.sendMessage(chatId, errorReply).catch(() => {});
        }
      }
    }

    bot.command("start", async (ctx) => {
      registerOutbound(ctx.chatId);
      const state = await getState(ctx.chatId);
      withLock(ctx.chatId, () => processMessage(ctx, state, "hi"));
    });

    bot.command(["restart", "new"], async (ctx) => {
      registerOutbound(ctx.chatId);
      const state = await restartChat(ctx.chatId);
      log.info({ chatId: ctx.chatId, room: `tg-${ctx.chatId}-${state.roomIndex}` }, "new telegram conversation");
      await ctx.reply("New conversation started.");
    });

    bot.on("message:text", async (ctx) => {
      registerOutbound(ctx.chatId);
      const state = await getState(ctx.chatId);
      withLock(ctx.chatId, () => processMessage(ctx, state, ctx.message.text));
    });

    bot.start({
      onStart: () => log.info("telegram bot polling started"),
    });

    this.bot = bot;
  }

  async stop(): Promise<void> {
    if (this.bot) {
      this.bot.stop();
      this.bot = null;
    }
  }
}

registerChannel(() => {
  if (!getConfig().telegram_bot_token) return null;
  return new TelegramChannel();
});
