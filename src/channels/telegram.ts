import { Bot, InputFile } from "grammy";
import { createChatEngine } from "../chat/engine";
import type { Channel, ChatState, Attachment } from "../types";
import { getConfig, updateRawConfig } from "../utils/config";
import { runMigrations } from "../db/migrate";
import { Session, Message } from "../db/models";
import { log } from "../utils/log";
import { getMcpServers } from "../mcp";
import { classifyMime, validateAttachment, prepareImage } from "../utils/attachment";


class TelegramChannel implements Channel {
  name = "telegram";
  private bot: Bot | null = null;
  private outboundChatId: number | null = null;

  async sendMessage(text: string): Promise<void> {
    if (!this.bot) throw new Error("Telegram not started");
    const chatId = this.outboundChatId;
    if (!chatId) throw new Error("No outbound chat ID registered");
    await this.bot.api.sendMessage(chatId, text);
  }

  async sendMedia(data: Buffer, mimeType: string, filename?: string): Promise<void> {
    if (!this.bot) throw new Error("Telegram not started");
    const chatId = this.outboundChatId;
    if (!chatId) throw new Error("No outbound chat ID registered");

    const file = new InputFile(data, filename);
    if (mimeType.startsWith("image/")) {
      await this.bot.api.sendPhoto(chatId, file);
    } else {
      await this.bot.api.sendDocument(chatId, file);
    }
  }

  private async downloadFile(fileId: string): Promise<Buffer> {
    if (!this.bot) throw new Error("Telegram not started");
    const file = await this.bot.api.getFile(fileId);
    const token = getConfig().channels.telegram.bot_token!;
    const url = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Download failed: ${resp.status}`);
    return Buffer.from(await resp.arrayBuffer());
  }

  async start(): Promise<void> {
    const config = getConfig();
    const token = config.channels.telegram.bot_token!;

    await runMigrations();

    this.outboundChatId = config.channels.telegram.chat_id;

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
        log.info({ chatId, room }, "telegram: creating chat engine");
        const engine = await createChatEngine({ room, channel: "telegram", resume: true, mcpServers: getMcpServers() });
        state = { engine, roomIndex: idx, lock: Promise.resolve() };
        chats.set(chatId, state);
        log.info({ chatId, room, activeSessions: chats.size }, "telegram: engine ready");
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

      // Persist a placeholder session immediately so the room index survives
      // daemon restarts (otherwise getState falls back to the old room).
      await Session.create(`placeholder-${room}`, room);

      const engine = await createChatEngine({ room, channel: "telegram", resume: false, mcpServers: getMcpServers() });
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
      const queued = state.lock !== Promise.resolve();
      if (queued) log.debug({ chatId }, "telegram: message queued behind active lock");
      state.lock = state.lock.then(fn, fn);
    }

    const isOpen = config.channels.telegram.open;
    const self = this;

    function registerOutbound(chatId: number): void {
      if (self.outboundChatId) return;
      self.outboundChatId = chatId;
      updateRawConfig({ channels: { telegram: { chat_id: chatId } } });
      log.info({ chatId }, "auto-registered outbound chat ID");
    }

    function isAllowed(chatId: number): boolean {
      if (isOpen) return true;
      if (!self.outboundChatId) return true; // first user always allowed (gets registered)
      return chatId === self.outboundChatId;
    }

    const bot = new Bot(token);

    async function processMessage(ctx: any, state: ChatState, text: string, attachments?: Attachment[]): Promise<void> {
      const chatId = ctx.chatId;
      log.info({ chatId, text: text.slice(0, 100), attachments: attachments?.length || 0 }, "telegram message received");

      // Show typing indicator throughout
      const typingInterval = setInterval(() => {
        bot.api.sendChatAction(chatId, "typing").catch(() => {});
      }, 4000);
      bot.api.sendChatAction(chatId, "typing").catch(() => {});

      try {
        const { result, messageId } = await state.engine.send(text, {}, attachments);

        const reply = result.trim() || "(no response)";
        try {
          try {
            await bot.api.sendMessage(chatId, reply, { parse_mode: "MarkdownV2" });
          } catch {
            await bot.api.sendMessage(chatId, reply);
          }
          if (messageId) await Message.updateDeliveryStatus(messageId, "sent").catch(() => {});
          log.info({ chatId, chars: result.length }, "telegram reply sent");
        } catch (sendErr) {
          if (messageId) await Message.updateDeliveryStatus(messageId, "failed").catch(() => {});
          throw sendErr;
        }
      } catch (err) {
        const errText = err instanceof Error ? err.message : String(err);
        log.error({ err, chatId }, "telegram message processing failed");
        await bot.api.sendMessage(chatId, `[error] ${errText}`).catch(() => {});
      } finally {
        clearInterval(typingInterval);
      }
    }

    bot.command("start", async (ctx) => {
      if (!isAllowed(ctx.chatId)) {
        await ctx.reply("Unauthorized.");
        return;
      }
      registerOutbound(ctx.chatId);
      const state = await getState(ctx.chatId);
      withLock(ctx.chatId, () => processMessage(ctx, state, "hi"));
    });

    bot.command(["restart", "new"], async (ctx) => {
      if (!isAllowed(ctx.chatId)) {
        await ctx.reply("Unauthorized.");
        return;
      }
      registerOutbound(ctx.chatId);
      const state = await restartChat(ctx.chatId);
      log.info({ chatId: ctx.chatId, room: `tg-${ctx.chatId}-${state.roomIndex}` }, "new telegram conversation");
      await ctx.reply("New conversation started.");
    });

    bot.on("message:text", async (ctx) => {
      if (!isAllowed(ctx.chatId)) {
        await ctx.reply("Unauthorized.");
        return;
      }
      registerOutbound(ctx.chatId);
      const state = await getState(ctx.chatId);
      withLock(ctx.chatId, () => processMessage(ctx, state, ctx.message.text));
    });

    bot.on("message:photo", async (ctx) => {
      if (!isAllowed(ctx.chatId)) {
        await ctx.reply("Unauthorized.");
        return;
      }
      registerOutbound(ctx.chatId);
      const state = await getState(ctx.chatId);
      withLock(ctx.chatId, async () => {
        try {
          const photos = ctx.message.photo;
          const largest = photos[photos.length - 1];
          const raw = await self.downloadFile(largest.file_id);
          const { data, mimeType } = await prepareImage(raw, "image/jpeg");
          const attachment: Attachment = { type: "image", data, mimeType };
          const caption = ctx.message.caption || "What's in this image?";
          await processMessage(ctx, state, caption, [attachment]);
        } catch (err) {
          log.error({ err, chatId: ctx.chatId }, "failed to process photo");
          await ctx.reply("Failed to process image.").catch(() => {});
        }
      });
    });

    bot.on("message:document", async (ctx) => {
      if (!isAllowed(ctx.chatId)) {
        await ctx.reply("Unauthorized.");
        return;
      }
      registerOutbound(ctx.chatId);
      const state = await getState(ctx.chatId);
      withLock(ctx.chatId, async () => {
        try {
          const doc = ctx.message.document;
          const mime = doc.mime_type || "application/octet-stream";
          const attType = classifyMime(mime);
          if (!attType) {
            await ctx.reply(`Unsupported file type: ${mime}`);
            return;
          }
          let data = await self.downloadFile(doc.file_id);
          const error = validateAttachment(data, mime);
          if (error) {
            await ctx.reply(error);
            return;
          }
          let finalMime = mime;
          if (attType === "image") {
            const prepared = await prepareImage(data, mime);
            data = prepared.data;
            finalMime = prepared.mimeType;
          }
          const attachment: Attachment = { type: attType, data, mimeType: finalMime, filename: doc.file_name };
          const caption = ctx.message.caption || (attType === "image" ? "What's in this image?" : "Here's a document.");
          await processMessage(ctx, state, caption, [attachment]);
        } catch (err) {
          log.error({ err, chatId: ctx.chatId }, "failed to process document");
          await ctx.reply("Failed to process document.").catch(() => {});
        }
      });
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

export function createTelegramChannel(): TelegramChannel | null {
  if (!getConfig().channels.telegram.bot_token) return null;
  return new TelegramChannel();
}
