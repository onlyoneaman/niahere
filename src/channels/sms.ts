/**
 * SMS channel via Twilio.
 *
 * Same Twilio number as voice (channels.phone.from_number by default,
 * overridable via channels.sms.from_number). Inbound webhook →
 * chat engine → REST reply. Reuses the shared TwilioWebhookServer for
 * routing, signature validation, dedup, and rate-limiting.
 *
 * Use case: cellular-only-no-data reachability — Aman can text Nia from
 * patchy zones (Ladakh highways, basements, etc.) where Telegram /
 * WhatsApp / voice over data won't work but SMS over SS7 still does.
 *
 * Note: outbound from US Twilio long codes to Indian mobile numbers has
 * variable deliverability under TRAI scrubbing rules. Test empirically;
 * if outbound fails, the inbound leg (Aman → Nia) is more reliable.
 */
import { createChatEngine } from "../chat/engine";
import { getMcpServers } from "../mcp";
import { Session } from "../db/models";
import { runMigrations } from "../db/migrate";
import type { Channel, ChatState, Outbound, TwilioConfig } from "../types";
import { getConfig } from "../utils/config";
import { log } from "../utils/log";
import { sendMessage as twilioSendMessage } from "./twilio/rest";
import { getTwilioServer } from "./twilio/server";

const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

class SmsChannel implements Channel {
  name = "sms" as const;
  private readonly twilio: TwilioConfig;
  /** Cached resolved "from" number: sms.from_number || phone.from_number */
  private readonly fromNumber: string;
  private readonly chats = new Map<string, ChatState>();

  constructor(twilio: TwilioConfig, fromNumber: string) {
    this.twilio = twilio;
    this.fromNumber = fromNumber;
  }

  async start(): Promise<void> {
    await runMigrations();

    const server = getTwilioServer();
    server.configure({
      port: this.twilio.port,
      publicBaseUrl: this.twilio.public_base_url,
      signingToken: this.twilio.auth_token || this.twilio.secret,
    });

    server.registerHttp("/twilio/sms/incoming", (_req, ctx) => this.handleInbound(ctx.params), {
      dedupOn: "MessageSid",
      rateLimitOn: "From",
    });
    server.registerHttp("/twilio/sms/status", (_req, ctx) => this.handleStatus(ctx.params), {
      dedupOn: "MessageSid",
    });

    if (this.twilio.owner_number) server.exemptFromRateLimit(this.twilio.owner_number);

    await server.start();

    log.info(
      {
        from: this.fromNumber,
        owner: this.twilio.owner_number,
        publicBaseUrl: this.twilio.public_base_url,
      },
      "sms channel started",
    );
  }

  async stop(): Promise<void> {
    for (const state of this.chats.values()) state.engine.close();
    this.chats.clear();
  }

  /** Outbound — used by send_message MCP tool. SMS is text-only; media is dropped with a warning. */
  async deliver(out: Outbound): Promise<void> {
    if (!this.twilio.owner_number) throw new Error("sms: owner_number not set");
    // SMS has no threading; recipient kind is ignored.
    if (out.media) {
      log.warn({ filename: out.media.filename }, "sms: media payload dropped (channel is text-only)");
    }
    if (out.text) {
      await this.sendTo(this.twilio.owner_number, out.text);
    }
  }

  // --- Inbound webhook ---

  private async handleInbound(params: Record<string, string>): Promise<Response> {
    const from = params.From || "";
    const body = params.Body || "";

    if (!this.isAllowed(from)) {
      log.warn({ from }, "sms: rejecting non-allowlisted sender");
      return new Response(EMPTY_TWIML, { status: 200, headers: { "Content-Type": "text/xml" } });
    }

    const state = await this.getState(from);
    // Ack the webhook immediately; reply via REST asynchronously to avoid
    // Twilio's ~15s webhook timeout when the engine takes longer.
    state.lock = state.lock.then(
      async () => {
        try {
          const { result } = await state.engine.send(body);
          const reply = result.trim() || "(no response)";
          await this.sendTo(from, reply);
        } catch (err) {
          log.error({ err, from }, "sms: engine error");
          await this.sendTo(from, `[error] ${err instanceof Error ? err.message : String(err)}`).catch(() => {});
        }
      },
      (err) => log.error({ err, from }, "sms: lock chain error"),
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
      "sms: delivery status",
    );
    return new Response("", { status: 204 });
  }

  // --- Outbound ---

  private async sendTo(remoteE164: string, body: string): Promise<void> {
    if (!this.twilio.sid || !this.twilio.secret) {
      log.warn("sms: twilio sid/secret missing, cannot send");
      return;
    }
    try {
      const res = await twilioSendMessage({
        accountSid: this.twilio.sid,
        authSid: this.twilio.sid,
        authSecret: this.twilio.secret,
        to: remoteE164,
        from: this.fromNumber,
        body,
        statusCallbackUrl: this.twilio.public_base_url ? `${this.twilio.public_base_url}/twilio/sms/status` : undefined,
      });
      log.info({ to: remoteE164, sid: res.messageSid, status: res.status }, "sms: sent");
    } catch (err) {
      log.error({ err, to: remoteE164 }, "sms: send failed");
    }
  }

  // --- Helpers ---

  private isAllowed(remoteE164: string): boolean {
    if (this.twilio.owner_number && remoteE164 === this.twilio.owner_number) return true;
    return this.twilio.allowlist.includes(remoteE164);
  }

  private async getState(remoteE164: string): Promise<ChatState> {
    let state = this.chats.get(remoteE164);
    if (state) return state;
    const prefix = `sms-${remoteE164}`;
    const idx = await Session.getLatestRoomIndex(prefix);
    const room = `${prefix}-${idx}`;
    log.info({ remoteE164, room }, "sms: creating chat engine");
    const engine = await createChatEngine({
      room,
      channel: "sms",
      resume: true,
      mcpServers: getMcpServers(),
    });
    state = { engine, roomIndex: idx, lock: Promise.resolve() };
    this.chats.set(remoteE164, state);
    return state;
  }
}

export function createSmsChannel(): SmsChannel | null {
  const { twilio, sms, phone } = getConfig().channels;
  if (!sms.enabled) return null;
  if (!twilio.sid || !twilio.secret) return null;
  // sms.from_number falls back to phone.from_number (same number for voice + SMS).
  const fromNumber = sms.from_number ?? phone.from_number;
  if (!fromNumber) return null;
  return new SmsChannel(twilio, fromNumber);
}

export type { SmsChannel };
