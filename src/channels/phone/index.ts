/**
 * Phone channel — voice calling via Twilio + OpenAI Realtime.
 *
 * Boots an HTTP+WebSocket server inside the daemon. Twilio reaches it
 * through a public tunnel (cloudflared in our setup). Two surfaces:
 *
 *   - Inbound: caller dials our Twilio number; we return TwiML that opens
 *     a Media Stream back to us; the stream is bridged to OpenAI Realtime.
 *
 *   - Outbound: place_call() initiates a Twilio call to a target number,
 *     with a per-call goal seeded into the realtime session.
 *
 * Submodules:
 *   - twilio.ts        — REST + webhook signature helpers
 *   - twiml.ts         — TwiML XML builders
 *   - relay.ts         — Twilio Media Stream <-> OpenAI Realtime bridge
 *   - instructions.ts  — system-prompt builders for inbound/outbound
 *   - tools.ts         — function-calling tools exposed to the realtime model
 *   - consult.ts       — escape hatch to Claude for memory-aware reasoning
 */
import type { Server, ServerWebSocket } from "bun";
import type { Channel, PhoneConfig } from "../../types";
import { getConfig } from "../../utils/config";
import { log } from "../../utils/log";
import { getChannel } from "../registry";
import { Session, Message } from "../../db/models";
import { runMigrations } from "../../db/migrate";

import { placeCall as twilioPlaceCall, updateCallUrl, validateTwilioSignature } from "./twilio";
import { streamTwiML, sayAndHangupTwiML, rejectTwiML } from "./twiml";
import { createRelay, type CallContext, type RelayHandle, type RelayResult } from "./relay";
import { buildInboundInstructions, buildOutboundInstructions } from "./instructions";
import { buildPhoneTools } from "./tools";

interface WsData {
  streamSid: string | null;
}

interface PendingCall {
  /** Context written when the call is initiated; consumed by the WS upgrade. */
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

class PhoneChannel implements Channel {
  name = "phone";
  private server: Server<WsData> | null = null;
  private readonly cfg: PhoneConfig;
  /** Calls placed/answered but whose Media Stream hasn't connected yet. */
  private readonly pending = new Map<string, PendingCall>();
  /** Active relays, keyed by streamSid (assigned on Twilio "start" event). */
  private readonly active = new Map<string, ActiveCall>();
  /** Per-callSid completion deferreds. Resolved when the call's transcript is persisted. */
  private readonly completions = new Map<string, Deferred<RelayResult>>();

  constructor(cfg: PhoneConfig) {
    this.cfg = cfg;
  }

  // --- Channel lifecycle ---

  async start(): Promise<void> {
    await runMigrations();
    const self = this;

    this.server = Bun.serve<WsData, never>({
      port: this.cfg.port,
      async fetch(req, server) {
        const path = new URL(req.url).pathname;

        if (path === "/healthz") return new Response("ok", { status: 200 });

        if (path === "/twilio/voice/stream") {
          const ok = server.upgrade(req, { data: { streamSid: null } });
          return ok ? undefined : new Response("expected websocket", { status: 400 });
        }
        if (path === "/twilio/voice/incoming" && req.method === "POST") {
          return await self.handleIncoming(req);
        }
        if (path.startsWith("/twilio/voice/outbound/") && req.method === "POST") {
          const callSid = decodeURIComponent(path.slice("/twilio/voice/outbound/".length));
          return await self.handleOutboundTwiml(req, callSid);
        }
        if (path === "/twilio/voice/status" && req.method === "POST") {
          return await self.handleStatus(req);
        }
        return new Response("not found", { status: 404 });
      },
      websocket: {
        message(ws, message) {
          const data = typeof message === "string" ? message : new TextDecoder().decode(message);
          const sid = ws.data.streamSid;
          if (sid) {
            const active = self.active.get(sid);
            if (active) {
              active.handle.onTwilioMessage(data);
              return;
            }
          }
          self.bootstrapWsMessage(ws, data).catch((err) => {
            log.error({ err }, "phone: ws bootstrap failed");
            try {
              ws.close();
            } catch {}
          });
        },
        close(ws) {
          const sid = ws.data.streamSid;
          if (!sid) return;
          const active = self.active.get(sid);
          if (active) active.handle.onTwilioClose();
        },
      },
    });

    log.info(
      {
        port: this.cfg.port,
        publicBaseUrl: this.cfg.public_base_url,
        from: this.cfg.from_number,
        owner: this.cfg.owner_number,
        realtimeModel: this.cfg.realtime_model,
        voice: this.cfg.voice,
      },
      "phone channel started",
    );
  }

  async stop(): Promise<void> {
    if (this.server) {
      this.server.stop(true);
      this.server = null;
    }
    for (const active of this.active.values()) active.handle.onTwilioClose();
    this.active.clear();
    this.pending.clear();
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

    // We don't know the callSid until Twilio returns it, so we initially
    // point Twilio at a placeholder TwiML URL, then immediately PATCH the
    // call to use the real callSid in the path. Twilio fetches the URL only
    // when the callee answers, so the swap is safe.
    const result = await twilioPlaceCall({
      ...creds,
      to: opts.number,
      from,
      twimlUrl: `${base}/twilio/voice/outbound/PLACEHOLDER`,
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

    await updateCallUrl({
      ...creds,
      callSid: result.callSid,
      url: `${base}/twilio/voice/outbound/${result.callSid}`,
    }).catch((err) => log.warn({ err, callSid: result.callSid }, "phone: failed to update call URL"));

    log.info({ callSid: result.callSid, to: opts.number }, "phone: outbound call placed");
    return result;
  }

  /**
   * Wait for an in-flight call to finish. Resolves with the final transcript
   * once the call has been persisted; returns null if the callSid is unknown.
   */
  async awaitCallCompletion(callSid: string): Promise<RelayResult | null> {
    const deferred = this.completions.get(callSid);
    return deferred ? deferred.promise : null;
  }

  // --- HTTP handlers ---

  private async handleIncoming(req: Request): Promise<Response> {
    const { params } = await readForm(req);
    if (!this.verifySignature(req, params)) return forbidden();

    const callSid = params.CallSid || "";
    const from = params.From || "";
    const { label, allowed } = this.classifyCaller(from);

    if (!allowed) {
      log.warn({ from, callSid }, "phone: rejecting unauthorized caller");
      getChannel("telegram")
        ?.sendMessage?.(`Phone: rejected call from ${from} (CallSid ${callSid})`)
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

  private async handleOutboundTwiml(req: Request, callSid: string): Promise<Response> {
    const { params } = await readForm(req);
    if (!this.verifySignature(req, params)) return forbidden();

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

  private async handleStatus(req: Request): Promise<Response> {
    const { params } = await readForm(req);
    if (!this.verifySignature(req, params)) return forbidden();
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

  // --- WebSocket bootstrap ---

  private async bootstrapWsMessage(ws: ServerWebSocket<WsData>, data: string): Promise<void> {
    let msg: any;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }
    if (msg.event === "connected") return; // first frame, no streamSid yet

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
      openAiKey: this.cfg.openai_api_key!,
      model: this.cfg.realtime_model,
      voice: this.cfg.voice,
      context,
    });

    ws.data.streamSid = streamSid;
    this.active.set(streamSid, { handle, context, startedAt: pending.startedAt });

    handle.onTwilioMessage(data); // forward the "start" event itself

    handle.completion
      .then((result) => this.persistCall(context, pending.startedAt, result))
      .catch((err) => log.error({ err, callSid: context.callSid }, "phone: persist failed"))
      .finally(() => this.active.delete(streamSid));
  }

  // --- Helpers ---

  private canStartRealtime(): boolean {
    return Boolean(this.cfg.openai_api_key && this.cfg.public_base_url);
  }

  private buildWssUrl(): string {
    const base = this.cfg.public_base_url!.replace(/^http/, "ws");
    return `${base}/twilio/voice/stream`;
  }

  private classifyCaller(from: string): { label: string; allowed: boolean } {
    if (from && from === this.cfg.owner_number) return { label: "Aman", allowed: true };
    if (from && this.cfg.allowlist.includes(from)) return { label: from, allowed: true };
    return { label: from || "unknown", allowed: false };
  }

  private verifySignature(req: Request, params: Record<string, string>): boolean {
    const secret = this.cfg.twilio_secret;
    if (!secret) return false;
    const signature = req.headers.get("X-Twilio-Signature") || "";
    const fullUrl = this.cfg.public_base_url ? `${this.cfg.public_base_url}${new URL(req.url).pathname}` : req.url;
    return validateTwilioSignature({ authToken: secret, fullUrl, params, signature });
  }

  private requireCreds(): { accountSid: string; authToken: string } {
    const sid = this.cfg.twilio_sid;
    const secret = this.cfg.twilio_secret;
    if (!sid || !secret) throw new Error("phone: TWILIO_SID/TWILIO_SECRET not configured");
    return { accountSid: sid, authToken: secret };
  }

  private requirePublicBaseUrl(): string {
    if (!this.cfg.public_base_url) throw new Error("phone: PUBLIC_BASE_URL not configured");
    return this.cfg.public_base_url;
  }

  private requireFromNumber(): string {
    if (!this.cfg.from_number) throw new Error("phone: PHONE_FROM_NUMBER not configured");
    return this.cfg.from_number;
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

async function readForm(req: Request): Promise<{ params: Record<string, string> }> {
  const body = await req.text();
  const params: Record<string, string> = {};
  const usp = new URLSearchParams(body);
  for (const [k, v] of usp) params[k] = v;
  return { params };
}

function twimlResponse(xml: string): Response {
  return new Response(xml, { status: 200, headers: { "Content-Type": "text/xml" } });
}

function forbidden(): Response {
  return new Response("invalid signature", { status: 403 });
}

// --- Factory ---

let _instance: PhoneChannel | null = null;

export function createPhoneChannel(): PhoneChannel | null {
  const cfg = getConfig().channels.phone;
  if (!cfg.twilio_sid || !cfg.twilio_secret || !cfg.from_number) return null;
  _instance = new PhoneChannel(cfg);
  return _instance;
}

/** Used by the place_call MCP tool and CLI test entrypoint. Null if not running. */
export function getPhoneChannel(): PhoneChannel | null {
  return _instance;
}

export type { PhoneChannel };
