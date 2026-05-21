/**
 * WhatsApp channel via Twilio (Sandbox by default).
 *
 * Reuses the shared TwilioWebhookServer. Inbound webhook hits
 * /twilio/whatsapp/incoming; we ack immediately (Twilio's 15s budget)
 * and reply via REST under a per-sender lock.
 *
 * Parity targets with the Telegram channel: text + images + documents +
 * voice notes (transcribed), /reset to start a new room, WhatsApp-flavored
 * markdown for outbound, 4096-char chunking, [error] reporting, delivery
 * status tracking. Outbound media is served from
 * channels/twilio/media-cache via GET /twilio/media/<sha>.<ext>.
 *
 * Sandbox: in Twilio Console → Messaging → Try it out → WhatsApp, point
 * the inbound webhook at `${PUBLIC_BASE_URL}/twilio/whatsapp/incoming`.
 * Users opt in by sending `join <two-words>` to `+1 415 523 8886`. Opt-in
 * expires after 72h of inactivity; the join code stays valid. Outbound
 * is further gated by Meta's 24-hour customer-service window.
 */
import { createChatEngine } from "../chat/engine";
import { getMcpServers } from "../mcp";
import { Session, Message } from "../db/models";
import { runMigrations } from "../db/migrate";
import type { Attachment, Channel, ChatState, Outbound, TwilioConfig, WhatsappConfig, PhoneConfig } from "../types";
import { getConfig } from "../utils/config";
import { log } from "../utils/log";
import { classifyMime, prepareImage, validateAttachment } from "../utils/attachment";
import { sendMessage as twilioSendMessage } from "./twilio/rest";
import { getTwilioServer } from "./twilio/server";
import { downloadInboundMedia, extractMedia } from "./twilio/media";
import { transcribeAudio } from "./twilio/transcribe";

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
const WA_PREFIX = "whatsapp:";
const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';
const CHUNK_LIMIT = 4096;
const RESET_RE = /^\s*\/(reset|new)\s*$/i;
const VOICE_MIME_PREFIX = "audio/";

class WhatsAppChannel implements Channel {
  name = "whatsapp" as const;
  private readonly twilio: TwilioConfig;
  private readonly whatsapp: WhatsappConfig;
  private readonly phone: PhoneConfig;
  private readonly chats = new Map<string, ChatState>();
  private readonly lastInboundAt = new Map<string, number>();

  constructor(twilio: TwilioConfig, whatsapp: WhatsappConfig, phone: PhoneConfig) {
    this.twilio = twilio;
    this.whatsapp = whatsapp;
    this.phone = phone;
  }

  async start(): Promise<void> {
    await runMigrations();

    const server = getTwilioServer();
    server.configure({
      port: this.twilio.port,
      publicBaseUrl: this.twilio.public_base_url,
      signingToken: this.twilio.auth_token || this.twilio.secret,
    });

    server.registerHttp("/twilio/whatsapp/incoming", (_req, ctx) => this.handleInbound(ctx.params), {
      dedupOn: "MessageSid",
      rateLimitOn: "From",
    });
    server.registerHttp("/twilio/whatsapp/status", (_req, ctx) => this.handleStatus(ctx.params), {
      dedupOn: "MessageSid",
    });

    if (this.twilio.owner_number) {
      server.exemptFromRateLimit(`${WA_PREFIX}${this.twilio.owner_number}`);
    }

    await server.start();

    log.info(
      {
        from: this.whatsapp.from_number,
        owner: this.twilio.owner_number,
        publicBaseUrl: this.twilio.public_base_url,
      },
      "whatsapp channel started",
    );
  }

  async stop(): Promise<void> {
    for (const state of this.chats.values()) state.engine.close();
    this.chats.clear();
  }

  /** Outbound to the owner — used by send_message MCP tool. WhatsApp has no threading. */
  async deliver(out: Outbound): Promise<void> {
    if (!this.twilio.owner_number) throw new Error("whatsapp: owner_number not set");
    const to = this.twilio.owner_number;
    if (out.media) {
      await this.sendMediaTo(to, Buffer.from(out.media.data), out.media.mimeType, out.media.filename);
    }
    if (out.text) {
      await this.sendTextTo(to, out.text);
    }
  }

  // --- Inbound webhook ---

  private async handleInbound(params: Record<string, string>): Promise<Response> {
    const from = (params.From || "").replace(/^whatsapp:/, "");
    const body = (params.Body || "").trim();

    if (!this.isAllowed(from)) {
      log.warn({ from }, "whatsapp: rejecting non-allowlisted sender");
      return new Response(EMPTY_TWIML, { status: 200, headers: { "Content-Type": "text/xml" } });
    }

    this.lastInboundAt.set(from, Date.now());

    if (RESET_RE.test(body)) {
      // Serialize through the same lock so a /reset chasing an in-flight
      // engine.send() waits its turn instead of yanking the engine away.
      const state = await this.getState(from);
      state.lock = state.lock.then(
        async () => {
          const newState = await this.restartChat(from);
          await this.sendTextTo(
            from,
            `New conversation started (room ${this.roomPrefix(from)}-${newState.roomIndex}).`,
          );
        },
        (err) => log.error({ err, from }, "whatsapp: /reset lock chain error"),
      );
      return new Response(EMPTY_TWIML, { status: 200, headers: { "Content-Type": "text/xml" } });
    }

    const descriptors = extractMedia(params);

    const state = await this.getState(from);
    state.lock = state.lock.then(
      async () => {
        let userText = body;
        let attachments: Attachment[] | undefined;

        if (descriptors.length > 0) {
          const downloaded = await downloadInboundMedia(descriptors, {
            accountSid: this.twilio.sid!,
            authSid: this.twilio.sid!,
            authSecret: this.twilio.secret!,
          });

          const voiceParts: string[] = [];
          const built: Attachment[] = [];

          for (const item of downloaded) {
            if (item.mime.startsWith(VOICE_MIME_PREFIX)) {
              if (!this.phone.openai_api_key) {
                voiceParts.push("[voice note: transcription unavailable — channels.phone.openai_api_key not set]");
                continue;
              }
              try {
                const transcript = await transcribeAudio({
                  apiKey: this.phone.openai_api_key,
                  data: item.data,
                  mime: item.mime,
                });
                voiceParts.push(transcript || "[empty voice note]");
              } catch (err) {
                log.error({ err, from }, "whatsapp: voice transcription failed");
                voiceParts.push(
                  `[voice note: transcription failed — ${err instanceof Error ? err.message : String(err)}]`,
                );
              }
              continue;
            }

            const error = validateAttachment(item.data);
            if (error) {
              log.warn({ from, mime: item.mime, error }, "whatsapp: rejecting attachment");
              await this.sendTextTo(from, `[error] ${error}`).catch(() => {});
              continue;
            }

            const attType = classifyMime(item.mime) || "file";
            let data = item.data;
            let mime = item.mime;
            if (attType === "image") {
              const prepared = await prepareImage(data, mime);
              data = prepared.data;
              mime = prepared.mimeType;
            }
            built.push({ type: attType, data, mimeType: mime });
          }

          if (voiceParts.length > 0) {
            const joined = voiceParts.join("\n\n");
            userText = userText ? `${userText}\n\n${joined}` : joined;
          }
          if (built.length > 0) attachments = built;
        }

        if (!userText && !attachments) {
          log.debug({ from }, "whatsapp: empty inbound (no body, no usable media)");
          return;
        }

        try {
          const { result, messageId } = await state.engine.send(userText || "(media only)", {}, attachments);
          const reply = result.trim() || "(no response)";
          try {
            await this.sendTextTo(from, reply);
            if (messageId) await Message.updateDeliveryStatus(messageId, "sent").catch(() => {});
          } catch (sendErr) {
            if (messageId) await Message.updateDeliveryStatus(messageId, "failed").catch(() => {});
            throw sendErr;
          }
        } catch (err) {
          log.error({ err, from }, "whatsapp: engine error");
          const errText = err instanceof Error ? err.message : String(err);
          await this.sendTextTo(from, `[error] ${errText}`).catch(() => {});
        }
      },
      (err) => log.error({ err, from }, "whatsapp: lock chain error"),
    );

    return new Response(EMPTY_TWIML, { status: 200, headers: { "Content-Type": "text/xml" } });
  }

  private handleStatus(params: Record<string, string>): Response {
    log.info(
      {
        messageSid: params.MessageSid,
        status: params.MessageStatus,
        errorCode: params.ErrorCode,
        to: params.To,
      },
      "whatsapp: delivery status",
    );
    return new Response("", { status: 204 });
  }

  // --- Outbound ---

  private async sendTextTo(remoteE164: string, body: string): Promise<void> {
    if (!this.canSend(remoteE164)) return;
    const converted = toWhatsAppMarkdown(body);
    const chunks = chunkText(converted, CHUNK_LIMIT);
    for (const chunk of chunks) {
      await this.postMessage(remoteE164, chunk, undefined);
    }
  }

  private async sendMediaTo(remoteE164: string, data: Buffer, mimeType: string, filename?: string): Promise<void> {
    if (!this.canSend(remoteE164)) return;
    const ext = filename ? extOf(filename) : undefined;
    let mediaUrl: string;
    try {
      mediaUrl = await getTwilioServer().serveMedia(new Uint8Array(data), mimeType, ext);
    } catch (err) {
      log.error({ err }, "whatsapp: serveMedia failed");
      return;
    }
    await this.postMessage(remoteE164, "", [mediaUrl]);
  }

  private async postMessage(remoteE164: string, body: string, mediaUrl: string[] | undefined): Promise<void> {
    try {
      const res = await twilioSendMessage({
        accountSid: this.twilio.sid!,
        authSid: this.twilio.sid!,
        authSecret: this.twilio.secret!,
        to: `${WA_PREFIX}${remoteE164}`,
        from: `${WA_PREFIX}${this.whatsapp.from_number}`,
        body,
        mediaUrl,
        statusCallbackUrl: this.twilio.public_base_url
          ? `${this.twilio.public_base_url}/twilio/whatsapp/status`
          : undefined,
      });
      log.info({ to: remoteE164, sid: res.messageSid, status: res.status, hasMedia: !!mediaUrl }, "whatsapp: sent");
    } catch (err) {
      log.error({ err, to: remoteE164 }, "whatsapp: send failed");
      throw err;
    }
  }

  /** Returns true if we have credentials AND we're inside the 24h window. */
  private canSend(remoteE164: string): boolean {
    if (!this.twilio.sid || !this.twilio.secret) {
      log.warn("whatsapp: twilio sid/secret missing, cannot send");
      return false;
    }
    if (!this.whatsapp.from_number) {
      log.warn("whatsapp: from_number not configured");
      return false;
    }
    const lastIn = this.lastInboundAt.get(remoteE164);
    const now = Date.now();
    if (!lastIn || now - lastIn > TWENTY_FOUR_HOURS_MS) {
      log.warn(
        {
          remoteE164,
          lastInboundAt: lastIn ? new Date(lastIn).toISOString() : null,
        },
        "whatsapp: outside 24h customer-service window — drop (Twilio rejects free-form; approved template needed)",
      );
      return false;
    }
    return true;
  }

  // --- Helpers ---

  private isAllowed(remoteE164: string): boolean {
    if (this.twilio.owner_number && remoteE164 === this.twilio.owner_number) return true;
    return this.twilio.allowlist.includes(remoteE164);
  }

  private roomPrefix(remoteE164: string): string {
    return `wa-${remoteE164}`;
  }

  private async getState(remoteE164: string): Promise<ChatState> {
    let state = this.chats.get(remoteE164);
    if (state) return state;
    const prefix = this.roomPrefix(remoteE164);
    const idx = await Session.getLatestRoomIndex(prefix);
    const room = `${prefix}-${idx}`;
    log.info({ remoteE164, room }, "whatsapp: creating chat engine");
    const engine = await createChatEngine({
      room,
      channel: "whatsapp",
      resume: true,
      mcpServers: getMcpServers(),
    });
    state = { engine, roomIndex: idx, lock: Promise.resolve() };
    this.chats.set(remoteE164, state);
    return state;
  }

  private async restartChat(remoteE164: string): Promise<ChatState> {
    const old = this.chats.get(remoteE164);
    if (old) old.engine.close();

    const prefix = this.roomPrefix(remoteE164);
    const prevIdx = await Session.getLatestRoomIndex(prefix);
    const newIdx = prevIdx + 1;
    const room = `${prefix}-${newIdx}`;

    // Persist a placeholder session so the room index survives daemon
    // restarts (otherwise getState falls back to the old room).
    await Session.create(`placeholder-${room}`, room);

    const engine = await createChatEngine({
      room,
      channel: "whatsapp",
      resume: false,
      mcpServers: getMcpServers(),
    });
    const state: ChatState = { engine, roomIndex: newIdx, lock: Promise.resolve() };
    this.chats.set(remoteE164, state);
    log.info({ remoteE164, room }, "whatsapp: new conversation started");
    return state;
  }
}

/**
 * Translate the slice of Markdown the agent uses to WhatsApp's flavor.
 * WhatsApp's renderer accepts `*bold*`, `_italic_`, `~strike~`, and
 * triple-backtick code blocks. We only rewrite forms that would render
 * as literal punctuation otherwise (`**bold**`, `~~strike~~`); single
 * `*italic*` is left alone since detecting it without false positives
 * around bold is more trouble than it's worth.
 */
export function toWhatsAppMarkdown(text: string): string {
  return text.replace(/\*\*(.+?)\*\*/gs, "*$1*").replace(/~~(.+?)~~/gs, "~$1~");
}

/** Split text into chunks bounded by `limit` chars, preferring paragraph then line breaks. */
export function chunkText(text: string, limit: number): string[] {
  if (text.length <= limit) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > limit) {
    let cut = remaining.lastIndexOf("\n\n", limit);
    if (cut < limit / 2) cut = remaining.lastIndexOf("\n", limit);
    if (cut < limit / 2) cut = remaining.lastIndexOf(" ", limit);
    if (cut <= 0) cut = limit;
    chunks.push(remaining.slice(0, cut).trimEnd());
    remaining = remaining.slice(cut).trimStart();
  }
  if (remaining.length > 0) chunks.push(remaining);
  return chunks;
}

function extOf(filename: string): string | undefined {
  const dot = filename.lastIndexOf(".");
  if (dot < 0 || dot === filename.length - 1) return undefined;
  return filename.slice(dot + 1).toLowerCase();
}

export function createWhatsAppChannel(): WhatsAppChannel | null {
  const { twilio, whatsapp, phone } = getConfig().channels;
  if (!whatsapp.enabled) return null;
  if (!twilio.sid || !twilio.secret) return null;
  if (!whatsapp.from_number) return null;
  return new WhatsAppChannel(twilio, whatsapp, phone);
}

export type { WhatsAppChannel };
