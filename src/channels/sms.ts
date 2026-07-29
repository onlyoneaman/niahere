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
import { getMcpServers } from "../mcp";
import { runMigrations } from "../db/migrate";
import type { Channel, Outbound, TwilioConfig } from "../types";
import { getConfig } from "../utils/config";
import { log } from "../utils/log";
import { errMsg, ignore } from "../utils/errors";
import { sendMessage as twilioSendMessage } from "./twilio/rest";
import { getTwilioServer } from "./twilio/server";
import { ChatSessions, chainLock } from "./common/chat-session";
import { ackTwiml, deliveryStatusAck, isAllowedSender } from "./twilio/shared";

class SmsChannel implements Channel {
  name = "sms" as const;
  private readonly twilio: TwilioConfig;
  /** Cached resolved "from" number: sms.from_number || phone.from_number */
  private readonly fromNumber: string;
  private readonly chats: ChatSessions<string>;

  constructor(twilio: TwilioConfig, fromNumber: string) {
    this.twilio = twilio;
    this.fromNumber = fromNumber;
    this.chats = new ChatSessions((remote) => `sms-${remote}`, () => ({
      channel: "sms",
      mcpServers: getMcpServers(),
    }));
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
    this.chats.closeAll();
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

    if (!isAllowedSender(this.twilio, from)) {
      log.warn({ from }, "sms: rejecting non-allowlisted sender");
      return ackTwiml();
    }

    const state = await this.chats.get(from);
    // Ack the webhook immediately; reply via REST asynchronously to avoid
    // Twilio's ~15s webhook timeout when the engine takes longer.
    chainLock(state, async () => {
      try {
        const { result } = await state.engine.send(body);
        const reply = result.trim() || "(no response)";
        await this.sendTo(from, reply);
      } catch (err) {
        log.error({ err, from }, "sms: engine error");
        await ignore(this.sendTo(from, `[error] ${errMsg(err)}`), "reply engine error");
      }
    });

    return ackTwiml();
  }

  private handleStatus(params: Record<string, string>): Response {
    return deliveryStatusAck("sms", params);
  }

  // --- Outbound ---

  private async sendTo(remoteE164: string, body: string): Promise<void> {
    if (!this.twilio.sid || !this.twilio.secret) {
      throw new Error("sms: twilio sid/secret missing, cannot send");
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
      // Rethrow so deliver() propagates the failure: the inbound handler falls
      // back to an error reply, and the send_message tool reports "Failed to
      // send" instead of falsely claiming delivery.
      throw err;
    }
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
