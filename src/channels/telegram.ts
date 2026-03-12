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

const MAX_RETRIES = 3;
const BASE_RETRY_MS = 1000;

async function replyWithRetry(ctx: any, text: string): Promise<void> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      await ctx.reply(text, { parse_mode: "Markdown" });
      return;
    } catch (err) {
      if (attempt === 0) {
        try {
          await ctx.reply(text);
          return;
        } catch {
          // fall through to retry
        }
      }

      if (attempt < MAX_RETRIES - 1) {
        const delay = BASE_RETRY_MS * Math.pow(2, attempt);
        log.warn({ attempt: attempt + 1, delay, chatId: ctx.chatId }, "telegram reply failed, retrying");
        await new Promise((r) => setTimeout(r, delay));
      } else {
        log.error({ err, chatId: ctx.chatId }, "telegram reply failed after all retries");
        throw err;
      }
    }
  }
}

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

    async function processMessage(ctx: any, state: ChatState, text: string): Promise<void> {
      const chatId = ctx.chatId;
      log.info({ chatId, text: text.slice(0, 100) }, "telegram message received");

      const typingInterval = setInterval(() => {
        ctx.replyWithChatAction("typing").catch(() => {});
      }, 4000);
      ctx.replyWithChatAction("typing").catch(() => {});

      try {
        const { result } = await state.engine.send(text);
        clearInterval(typingInterval);

        const reply = result.trim() || "(no response)";
        await replyWithRetry(ctx, reply);
        log.info({ chatId, chars: result.length }, "telegram reply sent");
      } catch (err) {
        clearInterval(typingInterval);
        log.error({ err, chatId }, "telegram message processing failed");
        await ctx.reply(`[error] ${err instanceof Error ? err.message : String(err)}`).catch(() => {});
      }
    }

    const bot = new Bot(token);

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

// Self-register: returns null if no token configured
registerChannel(() => {
  if (!process.env.TELEGRAM_BOT_TOKEN) return null;
  return new TelegramChannel();
});
