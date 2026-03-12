import { Bot } from "grammy";
import type { Channel } from "./channel";
import { registerChannel } from "./index";
import { createChatEngine, type ChatEngine } from "../chat/engine";
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

  async start(workspace: string): Promise<void> {
    const token = process.env.TELEGRAM_BOT_TOKEN!;

    await runMigrations();

    const allowedChatId = process.env.TELEGRAM_CHAT_ID
      ? Number(process.env.TELEGRAM_CHAT_ID)
      : null;

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
        const engine = await createChatEngine(workspace, { room, channel: "telegram", resume: true });
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
      const engine = await createChatEngine(workspace, { room, channel: "telegram", resume: false });
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

    function isAllowed(chatId: number): boolean {
      if (!allowedChatId) return true;
      return chatId === allowedChatId;
    }

    const bot = new Bot(token);

    async function processMessage(ctx: any, state: ChatState, text: string): Promise<void> {
      const chatId = ctx.chatId;
      log.info({ chatId, text: text.slice(0, 100) }, "telegram message received");

      // Keep typing indicator active throughout
      const typingInterval = setInterval(() => {
        bot.api.sendChatAction(chatId, "typing").catch(() => {});
      }, 4000);
      bot.api.sendChatAction(chatId, "typing").catch(() => {});

      // Send placeholder message
      let sentMsg: any;
      try {
        sentMsg = await bot.api.sendMessage(chatId, "Thinking...");
      } catch (err) {
        clearInterval(typingInterval);
        log.error({ err, chatId }, "failed to send placeholder");
        return;
      }

      const messageId = sentMsg.message_id;
      let lastEditedText = "";
      let lastEditTime = 0;
      let pendingEdit: string | null = null;
      let editTimer: ReturnType<typeof setTimeout> | null = null;

      function scheduleEdit(newText: string): void {
        // Truncate for Telegram's 4096 char limit, add ellipsis
        const display = newText.length > 4000 ? newText.slice(-4000) + "..." : newText;
        if (display === lastEditedText) return;

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
        if (!pendingEdit || pendingEdit === lastEditedText) return;

        const text = pendingEdit;
        pendingEdit = null;
        lastEditedText = text;
        lastEditTime = Date.now();

        bot.api.editMessageText(chatId, messageId, text).catch(() => {});
      }

      try {
        const { result } = await state.engine.send(text, (textSoFar) => {
          const trimmed = textSoFar.trim();
          if (trimmed) scheduleEdit(trimmed);
        });

        clearInterval(typingInterval);

        // Clear any pending edit timer
        if (editTimer) {
          clearTimeout(editTimer);
          editTimer = null;
        }

        // Final edit with complete response (plain text — markdown breaks too often)
        const reply = result.trim() || "(no response)";
        await bot.api.editMessageText(chatId, messageId, reply).catch(() => {});

        log.info({ chatId, chars: result.length }, "telegram reply sent");
      } catch (err) {
        clearInterval(typingInterval);

        if (editTimer) {
          clearTimeout(editTimer);
          editTimer = null;
        }

        const errMsg = err instanceof Error ? err.message : String(err);
        log.error({ err, chatId }, "telegram message processing failed");
        await bot.api.editMessageText(chatId, messageId, `[error] ${errMsg}`).catch(() => {});
      }
    }

    bot.command("start", async (ctx) => {
      if (!isAllowed(ctx.chatId)) return;
      const state = await getState(ctx.chatId);
      withLock(ctx.chatId, () => processMessage(ctx, state, "hi"));
    });

    bot.command(["restart", "new"], async (ctx) => {
      if (!isAllowed(ctx.chatId)) return;
      const state = await restartChat(ctx.chatId);
      log.info({ chatId: ctx.chatId, room: `tg-${ctx.chatId}-${state.roomIndex}` }, "new telegram conversation");
      await ctx.reply("New conversation started.");
    });

    bot.on("message:text", async (ctx) => {
      const chatId = ctx.chatId;

      if (!isAllowed(chatId)) {
        log.debug({ chatId }, "ignored message from unauthorized chat");
        return;
      }

      if (!allowedChatId) {
        log.info({ chatId }, "message from unregistered chat (set TELEGRAM_CHAT_ID to restrict)");
      }

      const state = await getState(chatId);
      withLock(chatId, () => processMessage(ctx, state, ctx.message.text));
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
  if (!process.env.TELEGRAM_BOT_TOKEN) return null;
  return new TelegramChannel();
});
