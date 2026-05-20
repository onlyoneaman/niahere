/**
 * Bridges a Twilio Media Streams WebSocket to OpenAI's Realtime API.
 *
 * Both endpoints use g711_ulaw audio at 8kHz so no resampling is needed —
 * we pass the base64 audio payload through after reframing JSON envelopes.
 *
 * Usage:
 *   const relay = createRelay({ ... });
 *   await relay.ready;            // session.update has been sent
 *   relay.onTwilioMessage(raw);   // for each frame from the Twilio WS
 *   relay.onTwilioClose();        // when the Twilio WS closes
 *   const result = await relay.completion;
 */
import { log } from "../../utils/log";

export interface PhoneToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<string>;
}

export interface CallContext {
  callSid: string;
  streamSid?: string;
  direction: "inbound" | "outbound";
  /** Caller phone number (E.164) for inbound, callee for outbound. */
  remoteNumber: string | null;
  /** Owner/contact label for logging and persona context. */
  remoteLabel: string;
  instructions: string;
  tools: PhoneToolDefinition[];
  /** Whether the model should speak first (true for outbound calls). */
  speakFirst: boolean;
  /** Optional opener line for outbound; the model expands on it. */
  opener?: string;
}

export interface TranscriptTurn {
  role: "user" | "assistant";
  text: string;
  ts: number;
}

export type RelayEndReason = "twilio_stop" | "openai_close" | "tool_end_call" | "error";

export interface RelayResult {
  transcript: TranscriptTurn[];
  endedReason: RelayEndReason;
  error?: string;
}

export interface RelayOpts {
  /** WebSocket bound to the Twilio Media Stream connection. */
  twilioWs: WebSocketLike;
  openAiKey: string;
  model: string;
  voice: string;
  context: CallContext;
}

export interface WebSocketLike {
  send(data: string | ArrayBufferLike | Uint8Array): void;
  close(code?: number, reason?: string): void;
  readyState: number;
}

export interface RelayHandle {
  /** Resolves once the OpenAI session.update has been sent. */
  ready: Promise<void>;
  /** Resolves once the call has fully wound down (Twilio stop or OpenAI close). */
  completion: Promise<RelayResult>;
  onTwilioMessage(raw: string): void;
  /** Call when the Twilio WebSocket closes (event or our own close). */
  onTwilioClose(): void;
}

export function createRelay(opts: RelayOpts): RelayHandle {
  const { twilioWs, openAiKey, model, voice, context } = opts;
  const transcript: TranscriptTurn[] = [];
  let endedReason: RelayEndReason = "twilio_stop";
  let errorMsg: string | undefined;
  let finalized = false;
  let pendingAssistantText = "";

  const openAiUrl = `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(model)}`;
  const openAiWs = new WebSocket(openAiUrl, {
    headers: { Authorization: `Bearer ${openAiKey}` },
  } as any);

  /** Whether a response is currently in flight on the OpenAI side. */
  let responseActive = false;

  let resolveReady: () => void;
  let rejectReady: (err: Error) => void;
  const ready = new Promise<void>((res, rej) => {
    resolveReady = res;
    rejectReady = rej;
  });

  let resolveCompletion: (result: RelayResult) => void;
  const completion = new Promise<RelayResult>((res) => {
    resolveCompletion = res;
  });

  function sendOpenAi(payload: Record<string, unknown>): void {
    if (openAiWs.readyState !== 1) return;
    openAiWs.send(JSON.stringify(payload));
  }

  function sendTwilio(payload: Record<string, unknown>): void {
    if (twilioWs.readyState !== 1) return;
    twilioWs.send(JSON.stringify(payload));
  }

  function finalize(reason?: RelayEndReason): void {
    if (finalized) return;
    finalized = true;
    if (reason) endedReason = reason;
    if (pendingAssistantText.trim()) {
      transcript.push({ role: "assistant", text: pendingAssistantText.trim(), ts: Date.now() });
      pendingAssistantText = "";
    }
    try {
      if (openAiWs.readyState === 1) openAiWs.close();
    } catch {}
    resolveCompletion({ transcript, endedReason, error: errorMsg });
  }

  openAiWs.addEventListener("open", () => {
    log.info({ callSid: context.callSid, model }, "openai realtime: connected");
    sendOpenAi({
      type: "session.update",
      session: {
        type: "realtime",
        model,
        // Without this explicit list, the GA session silently drops audio
        // synthesis and only emits transcripts — verified empirically.
        output_modalities: ["audio"],
        instructions: context.instructions,
        audio: {
          input: {
            format: { type: "audio/pcmu" },
            transcription: { model: "whisper-1" },
            turn_detection: { type: "server_vad", threshold: 0.5, silence_duration_ms: 300 },
          },
          output: {
            format: { type: "audio/pcmu" },
            voice,
          },
        },
        tools: context.tools.map((t) => ({
          type: "function",
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        })),
        tool_choice: "auto",
      },
    });
    if (context.speakFirst) {
      sendOpenAi({
        type: "response.create",
        response: {
          instructions: context.opener || "Greet the caller warmly and explain what you can help with.",
        },
      });
    }
    resolveReady();
  });

  openAiWs.addEventListener("error", (ev) => {
    const msg = (ev as ErrorEvent).message || "openai websocket error";
    log.error({ callSid: context.callSid, err: msg }, "openai realtime: error");
    errorMsg = msg;
    rejectReady(new Error(msg));
    finalize("error");
  });

  openAiWs.addEventListener("close", () => {
    log.info({ callSid: context.callSid }, "openai realtime: closed");
    finalize(endedReason === "twilio_stop" ? "openai_close" : endedReason);
  });

  openAiWs.addEventListener("message", async (ev) => {
    const isText = typeof ev.data === "string";
    let evt: any;
    try {
      evt = JSON.parse(isText ? ev.data : new TextDecoder().decode(ev.data as ArrayBuffer));
    } catch {
      log.debug(
        {
          callSid: context.callSid,
          isText,
          bytes: isText ? (ev.data as string).length : (ev.data as ArrayBuffer).byteLength,
        },
        "openai realtime: non-json frame dropped",
      );
      return;
    }

    switch (evt.type) {
      case "response.created": {
        responseActive = true;
        break;
      }
      case "response.done":
      case "response.cancelled": {
        responseActive = false;
        break;
      }
      // GA event names. We keep the older `response.audio.*` aliases for
      // forward/back compatibility — both fire `delta` with base64 audio.
      case "response.output_audio.delta":
      case "response.audio.delta": {
        if (!context.streamSid) return;
        sendTwilio({ event: "media", streamSid: context.streamSid, media: { payload: evt.delta } });
        break;
      }
      case "response.output_audio_transcript.delta":
      case "response.audio_transcript.delta": {
        pendingAssistantText += evt.delta || "";
        break;
      }
      case "response.output_audio_transcript.done":
      case "response.audio_transcript.done": {
        if (pendingAssistantText.trim()) {
          transcript.push({ role: "assistant", text: pendingAssistantText.trim(), ts: Date.now() });
          pendingAssistantText = "";
        }
        break;
      }
      case "conversation.item.input_audio_transcription.completed": {
        const text = (evt.transcript || "").trim();
        if (text) transcript.push({ role: "user", text, ts: Date.now() });
        break;
      }
      case "input_audio_buffer.speech_started": {
        if (context.streamSid) sendTwilio({ event: "clear", streamSid: context.streamSid });
        if (responseActive) {
          sendOpenAi({ type: "response.cancel" });
          responseActive = false;
        }
        break;
      }
      case "response.function_call_arguments.done": {
        const toolName = evt.name as string;
        const callId = evt.call_id as string;
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(evt.arguments || "{}");
        } catch {}
        const tool = context.tools.find((t) => t.name === toolName);
        let output = "";
        if (!tool) {
          output = `tool ${toolName} not available`;
          log.warn({ callSid: context.callSid, toolName }, "phone: unknown tool requested");
        } else {
          try {
            output = await tool.handler(args);
          } catch (err) {
            output = `error: ${err instanceof Error ? err.message : String(err)}`;
            log.error({ err, callSid: context.callSid, toolName }, "phone tool handler failed");
          }
        }
        sendOpenAi({
          type: "conversation.item.create",
          item: { type: "function_call_output", call_id: callId, output },
        });
        sendOpenAi({ type: "response.create" });

        if (toolName === "end_call") {
          setTimeout(() => finalize("tool_end_call"), 1500);
        }
        break;
      }
      case "error": {
        log.error({ callSid: context.callSid, evt }, "openai realtime: error event");
        break;
      }
      default: {
        // Track unrecognized event types at debug level — invaluable when the
        // GA API evolves and we need to discover new fields without breaking
        // production logs. Truncate the body to keep logs sane.
        const preview = JSON.stringify(evt).slice(0, 500);
        log.debug({ callSid: context.callSid, type: evt.type, preview }, "openai realtime: unhandled event");
      }
    }
  });

  function onTwilioMessage(raw: string): void {
    let msg: any;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    switch (msg.event) {
      case "connected":
        return;
      case "start": {
        context.streamSid = msg.start?.streamSid || msg.streamSid;
        log.info(
          { callSid: context.callSid, streamSid: context.streamSid, direction: context.direction },
          "phone: media stream started",
        );
        return;
      }
      case "media": {
        const payload = msg.media?.payload;
        if (payload) sendOpenAi({ type: "input_audio_buffer.append", audio: payload });
        return;
      }
      case "stop":
        finalize("twilio_stop");
        return;
    }
  }

  function onTwilioClose(): void {
    finalize(endedReason);
  }

  return { ready, completion, onTwilioMessage, onTwilioClose };
}
