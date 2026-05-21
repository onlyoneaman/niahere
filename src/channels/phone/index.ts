/**
 * Phone channel — voice calling via Twilio + OpenAI Realtime.
 *
 * Registers HTTP + WebSocket routes on the shared TwilioWebhookServer
 * (which other Twilio channels — sms, whatsapp — also use). The server
 * handles signature validation, dedup, and rate-limit middleware so this
 * file only owns voice-specific logic:
 *
 *   - Inbound: caller dials our Twilio number; we return TwiML that opens
 *     a Media Stream back to us; the stream is bridged to OpenAI Realtime.
 *
 *   - Outbound: place_call() initiates a Twilio call to a target number,
 *     with a per-call goal seeded into the realtime session.
 *
 * Submodules:
 *   - ../twilio/server.ts  — shared HTTP+WS server
 *   - ../twilio/rest.ts    — Twilio REST API helpers (placeCall, etc.)
 *   - twiml.ts             — TwiML XML builders
 *   - relay.ts             — Twilio Media Stream <-> OpenAI Realtime bridge
 *   - instructions.ts      — system-prompt builders for inbound/outbound
 *   - tools.ts             — function-calling tools exposed to the realtime model
 *   - consult.ts           — escape hatch to Claude for memory-aware reasoning
 */
import type { ServerWebSocket } from "bun";
import type { Channel, Outbound, PhoneConfig, TwilioConfig } from "../../types";
import { getConfig } from "../../utils/config";
import { log } from "../../utils/log";
import { getChannel } from "../registry";
import { Session, Message } from "../../db/models";
import { runMigrations } from "../../db/migrate";

import { getTwilioServer, type WsConnectionData } from "../twilio/server";
import { placeCall as twilioPlaceCall } from "../twilio/rest";
import { streamTwiML, sayAndHangupTwiML, rejectTwiML } from "./twiml";
import { createRelay, type CallContext, type RelayHandle, type RelayResult } from "./relay";
import { buildInboundInstructions, buildOutboundInstructions } from "./instructions";
import { buildPhoneTools } from "./tools";

interface PendingCall {
  context: Omit<CallContext, "streamSid" | "tools">;
  startedAt: number;
}

interface ActiveCall {
  handle: RelayHandle;
  context: CallContext;
  startedAt: number;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function defer<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const DEFAULT_MAX_MINUTES = 10;
const HARD_MAX_MINUTES = 30;

const WS_PATH = "/twilio/voice/stream";

class PhoneChannel implements Channel {
  name = "phone" as const;
  private readonly phone: PhoneConfig;
  private readonly twilio: TwilioConfig;
  private readonly pending = new Map<string, PendingCall>();
  /** Active relays keyed by streamSid. */
  private readonly active = new Map<string, ActiveCall>();
  /** Per-callSid completion deferreds; resolved after persistCall. */
  private readonly completions = new Map<string, Deferred<RelayResult>>();

  constructor(phone: PhoneConfig, twilio: TwilioConfig) {
    this.phone = phone;
    this.twilio = twilio;
  }

  async start(): Promise<void> {
    await runMigrations();

    const server = getTwilioServer();
    server.configure({
      port: this.twilio.port,
      publicBaseUrl: this.twilio.public_base_url,
      signingToken: this.twilio.auth_token || this.twilio.secret,
    });

    server.registerHttp("/twilio/voice/incoming", (req, ctx) => this.handleIncoming(req, ctx.params));
    server.registerHttp("/twilio/voice/outbound", (req, ctx) => this.handleOutboundTwiml(req, ctx.params));
    server.registerHttp("/twilio/voice/status", (_req, ctx) => this.handleStatus(ctx.params), {
      dedupOn: "CallSid",
    });

    server.registerWs(WS_PATH, {
      onMessage: (ws, data) => this.onWsMessage(ws, data),
      onClose: (ws) => this.onWsClose(ws),
    });

    // Owner number must never be rate-limited (e.g. urgent rapid retries).
    if (this.twilio.owner_number) server.exemptFromRateLimit(this.twilio.owner_number);

    await server.start();

    log.info(
      {
        port: this.twilio.port,
        publicBaseUrl: this.twilio.public_base_url,
        from: this.phone.from_number,
        owner: this.twilio.owner_number,
        realtimeModel: this.phone.realtime_model,
        voice: this.phone.voice,
      },
      "phone channel started",
    );
  }

  async stop(): Promise<void> {
    for (const active of this.active.values()) active.handle.onTwilioClose();
    this.active.clear();
    this.pending.clear();
    // The shared server is stopped by the daemon's channel teardown — leaving
    // it running here would block SMS/WhatsApp if they're also bound to it.
  }

  /**
   * Phone is voice-only — agent-initiated text/media doesn't have a sensible
   * delivery shape over Twilio Voice. Callers that want a text notification
   * about a call should target a text channel (telegram, slack, whatsapp).
   */
  async deliver(_out: Outbound): Promise<void> {
    throw new Error("phone: text/media delivery is not supported — use a text channel or placeCall() for voice");
  }

  // --- Outbound entrypoint (used by the place_call MCP tool and CLI test) ---

  async placeCall(opts: {
    number: string;
    goal: string;
    context?: string;
    maxMinutes?: number;
    voice?: string;
  }): Promise<{ callSid: string; status: string }> {
    const creds = this.requireCreds();
    const base = this.requirePublicBaseUrl();
    const from = this.requireFromNumber();

    const maxMinutes =
      opts.maxMinutes && opts.maxMinutes > 0 ? Math.min(opts.maxMinutes, HARD_MAX_MINUTES) : DEFAULT_MAX_MINUTES;
    const instructions = buildOutboundInstructions(opts.goal, opts.context);

    const result = await twilioPlaceCall({
      ...creds,
      to: opts.number,
      from,
      twimlUrl: `${base}/twilio/voice/outbound`,
      statusCallbackUrl: `${base}/twilio/voice/status`,
      maxDurationSec: maxMinutes * 60,
    });

    this.pending.set(result.callSid, {
      context: {
        callSid: result.callSid,
        direction: "outbound",
        remoteNumber: opts.number,
        remoteLabel: opts.number,
        instructions,
        speakFirst: true,
        opener: opts.goal,
      },
      startedAt: Date.now(),
    });
    this.completions.set(result.callSid, defer<RelayResult>());

    log.info({ callSid: result.callSid, to: opts.number }, "phone: outbound call placed");
    return result;
  }

  async awaitCallCompletion(callSid: string): Promise<RelayResult | null> {
    const deferred = this.completions.get(callSid);
    return deferred ? deferred.promise : null;
  }

  // --- HTTP handlers (signature already validated by the shared server) ---

  private async handleIncoming(_req: Request, params: Record<string, string>): Promise<Response> {
    const callSid = params.CallSid || "";
    const from = params.From || "";
    const { label, allowed } = this.classifyCaller(from);

    if (!allowed) {
      log.warn({ from, callSid }, "phone: rejecting unauthorized caller");
      getChannel("telegram")
        ?.deliver({ text: `Phone: rejected call from ${from} (CallSid ${callSid})` })
        .catch(() => {});
      return twimlResponse(sayAndHangupTwiML("Sorry, this line is not currently accepting calls. Goodbye."));
    }

    if (!this.canStartRealtime()) {
      log.warn({ callSid }, "phone: realtime not configured, playing fallback message");
      return twimlResponse(sayAndHangupTwiML("Hi, this is Nia. The voice loop is offline right now. Try again soon."));
    }

    this.pending.set(callSid, {
      context: {
        callSid,
        direction: "inbound",
        remoteNumber: from,
        remoteLabel: label,
        instructions: buildInboundInstructions(label),
        speakFirst: true,
        opener: `Greet ${label} by name and ask how you can help.`,
      },
      startedAt: Date.now(),
    });
    this.completions.set(callSid, defer<RelayResult>());

    return twimlResponse(streamTwiML(this.buildWssUrl(), { callSid, direction: "inbound" }));
  }

  private async handleOutboundTwiml(_req: Request, params: Record<string, string>): Promise<Response> {
    const callSid = params.CallSid || "";
    const pending = this.pending.get(callSid);
    if (!pending) {
      log.warn({ callSid }, "phone: outbound TwiML requested for unknown call");
      return twimlResponse(sayAndHangupTwiML("This call could not be set up. Goodbye."));
    }
    if (!this.canStartRealtime()) {
      return twimlResponse(rejectTwiML());
    }
    return twimlResponse(streamTwiML(this.buildWssUrl(), { callSid, direction: "outbound" }));
  }

  private handleStatus(params: Record<string, string>): Response {
    log.info(
      {
        callSid: params.CallSid,
        status: params.CallStatus,
        duration: params.CallDuration,
        direction: params.Direction,
      },
      "phone: call status",
    );
    return new Response("", { status: 204 });
  }

  // --- WebSocket plumbing (delegated by shared server to this channel) ---

  private onWsMessage(ws: ServerWebSocket<WsConnectionData>, data: string): void {
    const sid = (ws.data.channel as { streamSid?: string }).streamSid;
    if (sid) {
      const active = this.active.get(sid);
      if (active) {
        active.handle.onTwilioMessage(data);
        return;
      }
    }
    this.bootstrapWsMessage(ws, data).catch((err) => {
      log.error({ err }, "phone: ws bootstrap failed");
      try {
        ws.close();
      } catch {}
    });
  }

  private onWsClose(ws: ServerWebSocket<WsConnectionData>): void {
    const sid = (ws.data.channel as { streamSid?: string }).streamSid;
    if (!sid) return;
    const active = this.active.get(sid);
    if (active) active.handle.onTwilioClose();
  }

  private async bootstrapWsMessage(ws: ServerWebSocket<WsConnectionData>, data: string): Promise<void> {
    let msg: any;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }
    if (msg.event === "connected") return;

    if (msg.event !== "start") {
      log.warn({ event: msg.event }, "phone: unexpected first ws event");
      try {
        ws.close();
      } catch {}
      return;
    }

    const streamSid: string = msg.start?.streamSid;
    const callSidFromParams: string = msg.start?.customParameters?.callSid || msg.start?.callSid;
    const pending = this.pending.get(callSidFromParams);
    if (!pending) {
      log.warn({ callSid: callSidFromParams, streamSid }, "phone: stream started with no pending context");
      try {
        ws.close();
      } catch {}
      return;
    }
    this.pending.delete(callSidFromParams);

    const tools = buildPhoneTools({ callerLabel: pending.context.remoteLabel });
    const context: CallContext = { ...pending.context, streamSid, tools };

    const handle = createRelay({
      twilioWs: ws,
      openAiKey: this.phone.openai_api_key!,
      model: this.phone.realtime_model,
      voice: this.phone.voice,
      context,
    });

    (ws.data.channel as { streamSid?: string }).streamSid = streamSid;
    this.active.set(streamSid, { handle, context, startedAt: pending.startedAt });

    handle.onTwilioMessage(data);

    handle.completion
      .then((result) => this.persistCall(context, pending.startedAt, result))
      .catch((err) => log.error({ err, callSid: context.callSid }, "phone: persist failed"))
      .finally(() => this.active.delete(streamSid));
  }

  // --- Helpers ---

  private canStartRealtime(): boolean {
    return Boolean(this.phone.openai_api_key && this.twilio.public_base_url);
  }

  private buildWssUrl(): string {
    return getTwilioServer().buildWssUrl(WS_PATH);
  }

  private classifyCaller(from: string): { label: string; allowed: boolean } {
    if (from && from === this.twilio.owner_number) return { label: "Aman", allowed: true };
    if (from && this.twilio.allowlist.includes(from)) return { label: from, allowed: true };
    return { label: from || "unknown", allowed: false };
  }

  private requireCreds(): { accountSid: string; authSid: string; authSecret: string } {
    const sid = this.twilio.sid;
    const secret = this.twilio.secret;
    if (!sid || !secret) throw new Error("twilio: sid and secret not set (channels.twilio.* in config.yaml or env)");
    return { accountSid: sid, authSid: sid, authSecret: secret };
  }

  private requirePublicBaseUrl(): string {
    if (!this.twilio.public_base_url)
      throw new Error("twilio: public_base_url not set (channels.twilio.public_base_url or PUBLIC_BASE_URL env)");
    return this.twilio.public_base_url;
  }

  private requireFromNumber(): string {
    if (!this.phone.from_number)
      throw new Error("phone: from_number not set (channels.phone.from_number or PHONE_FROM_NUMBER env)");
    return this.phone.from_number;
  }

  private async persistCall(context: CallContext, startedAt: number, result: RelayResult): Promise<void> {
    const room = `phone-${context.callSid}`;
    const sessionId = `phone-${context.callSid}`;
    try {
      await Session.create(sessionId, room);
      for (const turn of result.transcript) {
        await Message.save({
          sessionId,
          room,
          sender: turn.role === "user" ? context.remoteLabel : "nia",
          content: turn.text,
          isFromAgent: turn.role === "assistant",
          deliveryStatus: "sent",
          metadata: {
            channel: "phone",
            direction: context.direction,
            remoteNumber: context.remoteNumber,
            callSid: context.callSid,
          },
        });
      }
      log.info(
        {
          callSid: context.callSid,
          direction: context.direction,
          turns: result.transcript.length,
          endedReason: result.endedReason,
          durationMs: Date.now() - startedAt,
        },
        "phone: call persisted",
      );
    } catch (err) {
      log.error({ err, callSid: context.callSid }, "phone: failed to persist call");
    } finally {
      const deferred = this.completions.get(context.callSid);
      if (deferred) {
        deferred.resolve(result);
        this.completions.delete(context.callSid);
      }
    }
  }
}

// --- Pure helpers ---

function twimlResponse(xml: string): Response {
  return new Response(xml, { status: 200, headers: { "Content-Type": "text/xml" } });
}

// --- Factory ---

let _instance: PhoneChannel | null = null;

export function createPhoneChannel(): PhoneChannel | null {
  const { twilio, phone } = getConfig().channels;
  if (!phone.enabled) return null;
  if (!twilio.sid || !twilio.secret || !phone.from_number) return null;
  _instance = new PhoneChannel(phone, twilio);
  return _instance;
}

export function getPhoneChannel(): PhoneChannel | null {
  return _instance;
}

export type { PhoneChannel };
