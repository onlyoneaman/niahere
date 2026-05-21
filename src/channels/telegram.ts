import { Bot, type Context, InputFile } from "grammy";
import { createHash } from "crypto";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import type { Channel, ChatState, Attachment, Outbound } from "../types";
import { getConfig, updateRawConfig } from "../utils/config";
import { runMigrations } from "../db/migrate";
import { Message } from "../db/models";
import { log } from "../utils/log";
import { getMcpServers } from "../mcp";
import { classifyMime, validateAttachment, prepareImage } from "../utils/attachment";
import { getNiaHome } from "../utils/paths";
import { chainLock, openChatEngine, rotateRoom } from "./common/chat-session";

function safeExtension(filename?: string): string {
  const ext = filename?.split(".").pop();
  return ext && /^[a-zA-Z0-9]{1,16}$/.test(ext) ? ext : "bin";
}

function cacheExtension(filename: string | undefined, mimeType: string): string {
  if (mimeType === "image/jpeg") return "jpg";
  return safeExtension(filename);
}

class TelegramChannel implements Channel {
  name = "telegram" as const;
  private bot: Bot | null = null;
  private outboundChatId: number | null = null;
  private isOpen = false;
  private readonly chats = new Map<number, ChatState>();

  async start(): Promise<void> {
    const config = getConfig();
    const token = config.channels.telegram.bot_token!;

    await runMigrations();

    this.outboundChatId = config.channels.telegram.chat_id;
    this.isOpen = config.channels.telegram.open;

    const bot = new Bot(token);
    this.bot = bot;

    bot.command("start", (ctx) => this.handleStart(ctx));
    bot.command(["restart", "new"], (ctx) => this.handleRestart(ctx));
    bot.on("message:text", (ctx) => this.handleText(ctx));
    bot.on("message:photo", (ctx) => this.handlePhoto(ctx));
    bot.on("message:document", (ctx) => this.handleDocument(ctx));

    bot.start({ onStart: () => log.info("telegram bot polling started") });
  }

  async stop(): Promise<void> {
    if (this.bot) {
      this.bot.stop();
      this.bot = null;
    }
  }

  async deliver(out: Outbound): Promise<void> {
    if (!this.bot) throw new Error("Telegram not started");
    const chatId = this.outboundChatId;
    if (!chatId) throw new Error("No outbound chat ID registered");
    // Telegram has no native threading; thread recipients fall back to the
    // configured DM chat (the same place we'd send to for `owner`).

    if (out.media) {
      const file = new InputFile(Buffer.from(out.media.data), out.media.filename);
      if (out.media.mimeType.startsWith("image/")) {
        await this.bot.api.sendPhoto(chatId, file);
      } else {
        await this.bot.api.sendDocument(chatId, file);
      }
    }
    if (out.text) {
      await this.bot.api.sendMessage(chatId, out.text);
    }
  }

  // --- Inbound handlers ---

  private async handleStart(ctx: Context): Promise<void> {
    if (!ctx.chatId || !this.gate(ctx)) return;
    this.registerOutbound(ctx.chatId);
    const state = await this.getState(ctx.chatId);
    this.withLock(ctx.chatId, () => this.processMessage(ctx, state, "hi"));
  }

  private async handleRestart(ctx: Context): Promise<void> {
    if (!ctx.chatId || !this.gate(ctx)) return;
    this.registerOutbound(ctx.chatId);
    const state = await this.restartChat(ctx.chatId);
    log.info({ chatId: ctx.chatId, room: `tg-${ctx.chatId}-${state.roomIndex}` }, "new telegram conversation");
    await ctx.reply("New conversation started.");
  }

  private async handleText(ctx: Context): Promise<void> {
    if (!ctx.chatId || !ctx.message?.text || !this.gate(ctx)) return;
    this.registerOutbound(ctx.chatId);
    const state = await this.getState(ctx.chatId);
    const text = ctx.message.text;
    this.withLock(ctx.chatId, () => this.processMessage(ctx, state, text));
  }

  private async handlePhoto(ctx: Context): Promise<void> {
    if (!ctx.chatId || !ctx.message?.photo || !this.gate(ctx)) return;
    this.registerOutbound(ctx.chatId);
    const state = await this.getState(ctx.chatId);
    const chatId = ctx.chatId;
    this.withLock(chatId, async () => {
      try {
        const photos = ctx.message!.photo!;
        const largest = photos[photos.length - 1];
        const raw = await this.downloadFile(largest.file_id);
        const { data, mimeType } = await prepareImage(raw, "image/jpeg");
        const attachment: Attachment = { type: "image", data, mimeType };
        const caption = ctx.message!.caption || "What's in this image?";
        await this.processMessage(ctx, state, caption, [attachment]);
      } catch (err) {
        log.error({ err, chatId }, "failed to process photo");
        await ctx.reply("Failed to process image.").catch(() => {});
      }
    });
  }

  private async handleDocument(ctx: Context): Promise<void> {
    if (!ctx.chatId || !ctx.message?.document || !this.gate(ctx)) return;
    this.registerOutbound(ctx.chatId);
    const state = await this.getState(ctx.chatId);
    const chatId = ctx.chatId;
    this.withLock(chatId, async () => {
      try {
        const doc = ctx.message!.document!;
        const mime = doc.mime_type || "application/octet-stream";
        const attType = classifyMime(mime) || "file";
        let data = await this.downloadFile(doc.file_id);
        const error = validateAttachment(data);
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
        const sourcePath = this.cacheAttachment(chatId, state.roomIndex, data, finalMime, doc.file_name);
        const attachment: Attachment = {
          type: attType,
          data,
          mimeType: finalMime,
          filename: doc.file_name,
          sourcePath,
        };
        const caption = ctx.message!.caption || (attType === "image" ? "What's in this image?" : "Here's a file.");
        await this.processMessage(ctx, state, caption, [attachment]);
      } catch (err) {
        log.error({ err, chatId }, "failed to process document");
        await ctx.reply("Failed to process document.").catch(() => {});
      }
    });
  }

  // --- Core message loop ---

  private async processMessage(
    ctx: Context,
    state: ChatState,
    text: string,
    attachments?: Attachment[],
  ): Promise<void> {
    if (!this.bot) return;
    const bot = this.bot;
    const chatId = ctx.chatId!;
    log.info({ chatId, text: text.slice(0, 100), attachments: attachments?.length || 0 }, "telegram message received");

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

  // --- Session / state helpers ---

  private async getState(chatId: number): Promise<ChatState> {
    let state = this.chats.get(chatId);
    if (state) return state;
    state = await openChatEngine(this.keyOf(chatId), () => ({ channel: "telegram", mcpServers: getMcpServers() }));
    this.chats.set(chatId, state);
    return state;
  }

  private async restartChat(chatId: number): Promise<ChatState> {
    const state = await rotateRoom(this.keyOf(chatId), this.chats.get(chatId), () => ({
      channel: "telegram",
      mcpServers: getMcpServers(),
    }));
    this.chats.set(chatId, state);
    return state;
  }

  private withLock(chatId: number, fn: () => Promise<void>): void {
    const state = this.chats.get(chatId);
    if (!state) {
      fn().catch((err) => log.error({ err, chatId }, "unhandled error in locked handler"));
      return;
    }
    chainLock(state, fn);
  }

  private keyOf(chatId: number): string {
    return `tg-${chatId}`;
  }

  // --- Authorization / outbound binding ---

  /** Authorization check + auto-reply with "Unauthorized." if not allowed. Returns true to continue. */
  private gate(ctx: Context): boolean {
    if (!ctx.chatId) return false;
    if (this.isAllowed(ctx.chatId)) return true;
    ctx.reply("Unauthorized.").catch(() => {});
    return false;
  }

  private isAllowed(chatId: number): boolean {
    if (this.isOpen) return true;
    if (!this.outboundChatId) return true; // first user always allowed (gets registered)
    return chatId === this.outboundChatId;
  }

  private registerOutbound(chatId: number): void {
    if (this.outboundChatId) return;
    this.outboundChatId = chatId;
    updateRawConfig({ channels: { telegram: { chat_id: chatId } } });
    log.info({ chatId }, "auto-registered outbound chat ID");
  }

  // --- File helpers ---

  private async downloadFile(fileId: string): Promise<Buffer> {
    if (!this.bot) throw new Error("Telegram not started");
    const file = await this.bot.api.getFile(fileId);
    const token = getConfig().channels.telegram.bot_token!;
    const url = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Download failed: ${resp.status}`);
    return Buffer.from(await resp.arrayBuffer());
  }

  private cacheAttachment(
    chatId: number,
    roomIndex: number,
    data: Buffer,
    mimeType: string,
    filename?: string,
  ): string {
    const scope = `telegram-${chatId}-${roomIndex}`;
    const dir = join(getNiaHome(), "tmp", "attachments", scope);
    mkdirSync(dir, { recursive: true });
    const ext = cacheExtension(filename, mimeType);
    const hash = createHash("sha256").update(data).digest("hex").slice(0, 16);
    const path = join(dir, `${hash}.${ext}`);
    writeFileSync(path, data);
    return path;
  }
}

export function createTelegramChannel(): TelegramChannel | null {
  if (!getConfig().channels.telegram.bot_token) return null;
  return new TelegramChannel();
}
