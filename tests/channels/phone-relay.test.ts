import { describe, expect, test } from "bun:test";
import { createRelay, type CallContext, type OpenAiSocket, type WebSocketLike } from "../../src/channels/phone/relay";

/** A socket that records what was sent and lets a test drive its events. */
function fakeSocket() {
  const sent: any[] = [];
  const listeners = new Map<string, ((ev: any) => void)[]>();
  const sock: OpenAiSocket & { sent: any[]; emit(type: string, ev?: any): void; closed: boolean; closeCount: number } = {
    readyState: 1,
    closed: false,
    closeCount: 0,
    sent,
    send: (d) => sent.push(JSON.parse(String(d))),
    close() {
      this.closed = true;
      this.closeCount++;
    },
    addEventListener(type, fn) {
      listeners.set(type, [...(listeners.get(type) ?? []), fn]);
    },
    emit(type, ev) {
      for (const fn of listeners.get(type) ?? []) fn(ev);
    },
  };
  return sock;
}

function fakeTwilio() {
  const sent: any[] = [];
  const ws: WebSocketLike & { sent: any[] } = {
    readyState: 1,
    sent,
    send: (d) => sent.push(JSON.parse(String(d))),
    close() {},
  };
  return ws;
}

function ctx(over: Partial<CallContext> = {}): CallContext {
  return {
    callSid: "CA1",
    direction: "inbound",
    instructions: "be brief",
    tools: [],
    streamSid: "MZ1",
    ...over,
  } as CallContext;
}

function build(over: Partial<CallContext> = {}) {
  const openAi = fakeSocket();
  const twilioWs = fakeTwilio();
  const relay = createRelay({
    twilioWs,
    openAiKey: "sk-test",
    model: "gpt-realtime",
    voice: "marin",
    context: ctx(over),
    openAiWsFactory: () => openAi,
  });
  return { relay, openAi, twilioWs };
}

const typesOf = (sent: any[]) => sent.map((m) => m.type ?? m.event);

describe("relay session setup", () => {
  test("configures the session once the socket opens", async () => {
    const { relay, openAi } = build();
    openAi.emit("open");
    await relay.ready;

    const update = openAi.sent.find((m) => m.type === "session.update");
    expect(update).toBeDefined();
    expect(update.session.instructions).toBe("be brief");
    expect(update.session.audio.output.voice).toBe("marin");
    // Without an explicit output modality the GA session silently drops audio.
    expect(update.session.output_modalities).toEqual(["audio"]);
  });

  test("an outbound call speaks first, an inbound one waits", async () => {
    const outbound = build({ speakFirst: true, opener: "Hi, it's Nia." });
    outbound.openAi.emit("open");
    await outbound.relay.ready;
    const opener = outbound.openAi.sent.find((m) => m.type === "response.create");
    expect(opener.response.instructions).toBe("Hi, it's Nia.");

    const inbound = build({ speakFirst: false });
    inbound.openAi.emit("open");
    await inbound.relay.ready;
    expect(typesOf(inbound.openAi.sent)).not.toContain("response.create");
  });
});

describe("relay audio bridging", () => {
  test("forwards caller audio to OpenAI", () => {
    const { relay, openAi } = build();
    relay.onTwilioMessage(JSON.stringify({ event: "media", media: { payload: "BASE64AUDIO" } }));
    expect(openAi.sent).toContainEqual({ type: "input_audio_buffer.append", audio: "BASE64AUDIO" });
  });

  test("forwards generated audio back to Twilio on both event names", () => {
    const { relay: _r, openAi, twilioWs } = build();
    openAi.emit("message", { data: JSON.stringify({ type: "response.output_audio.delta", delta: "AAA" }) });
    openAi.emit("message", { data: JSON.stringify({ type: "response.audio.delta", delta: "BBB" }) });

    expect(twilioWs.sent).toHaveLength(2);
    expect(twilioWs.sent[0]).toMatchObject({ event: "media", streamSid: "MZ1", media: { payload: "AAA" } });
    expect(twilioWs.sent[1].media.payload).toBe("BBB");
  });

  test("drops generated audio until the stream id is known", () => {
    const { openAi, twilioWs } = build({ streamSid: undefined });
    openAi.emit("message", { data: JSON.stringify({ type: "response.output_audio.delta", delta: "AAA" }) });
    expect(twilioWs.sent).toHaveLength(0);
  });

  test("learns the stream id from Twilio's start event", () => {
    const { relay, openAi, twilioWs } = build({ streamSid: undefined });
    relay.onTwilioMessage(JSON.stringify({ event: "start", start: { streamSid: "MZ9" } }));
    openAi.emit("message", { data: JSON.stringify({ type: "response.output_audio.delta", delta: "AAA" }) });
    expect(twilioWs.sent[0].streamSid).toBe("MZ9");
  });

  test("barge-in clears queued audio and cancels the in-flight response", () => {
    const { openAi, twilioWs } = build();
    openAi.emit("message", { data: JSON.stringify({ type: "response.created" }) });
    openAi.emit("message", { data: JSON.stringify({ type: "input_audio_buffer.speech_started" }) });

    expect(twilioWs.sent).toContainEqual({ event: "clear", streamSid: "MZ1" });
    expect(typesOf(openAi.sent)).toContain("response.cancel");
  });

  test("does not cancel when nothing is being spoken", () => {
    const { openAi } = build();
    openAi.emit("message", { data: JSON.stringify({ type: "input_audio_buffer.speech_started" }) });
    expect(typesOf(openAi.sent)).not.toContain("response.cancel");
  });

  test("ignores a frame that is not JSON instead of throwing", () => {
    const { openAi } = build();
    expect(() => openAi.emit("message", { data: "not json at all" })).not.toThrow();
  });
});

describe("relay transcript", () => {
  test("records both sides of the conversation", async () => {
    const { relay, openAi } = build();
    openAi.emit("message", {
      data: JSON.stringify({ type: "conversation.item.input_audio_transcription.completed", transcript: " hello " }),
    });
    openAi.emit("message", { data: JSON.stringify({ type: "response.output_audio_transcript.delta", delta: "hi " }) });
    openAi.emit("message", { data: JSON.stringify({ type: "response.output_audio_transcript.delta", delta: "there" }) });
    openAi.emit("message", { data: JSON.stringify({ type: "response.output_audio_transcript.done" }) });

    relay.onTwilioMessage(JSON.stringify({ event: "stop" }));
    const { transcript } = await relay.completion;

    expect(transcript.map((t) => [t.role, t.text])).toEqual([
      ["user", "hello"],
      ["assistant", "hi there"],
    ]);
  });

  test("flushes a half-finished assistant turn when the call ends mid-sentence", async () => {
    const { relay, openAi } = build();
    openAi.emit("message", {
      data: JSON.stringify({ type: "response.output_audio_transcript.delta", delta: "I was saying" }),
    });
    relay.onTwilioMessage(JSON.stringify({ event: "stop" }));

    const { transcript } = await relay.completion;
    expect(transcript).toEqual([{ role: "assistant", text: "I was saying", ts: expect.any(Number) }]);
  });

  test("skips an empty transcription", async () => {
    const { relay, openAi } = build();
    openAi.emit("message", {
      data: JSON.stringify({ type: "conversation.item.input_audio_transcription.completed", transcript: "   " }),
    });
    relay.onTwilioMessage(JSON.stringify({ event: "stop" }));
    expect((await relay.completion).transcript).toEqual([]);
  });
});

describe("relay tool calls", () => {
  const toolCall = (name: string, args = "{}") =>
    JSON.stringify({ type: "response.function_call_arguments.done", name, call_id: "c1", arguments: args });

  test("runs the tool and feeds its output back", async () => {
    const calls: unknown[] = [];
    const { openAi } = build({
      tools: [
        {
          name: "save_memory",
          description: "",
          parameters: {},
          handler: async (a: unknown) => {
            calls.push(a);
            return "saved";
          },
        },
      ],
    } as Partial<CallContext>);

    openAi.emit("message", { data: toolCall("save_memory", '{"text":"remember this"}') });
    await Bun.sleep(5);

    expect(calls).toEqual([{ text: "remember this" }]);
    const output = openAi.sent.find((m) => m.type === "conversation.item.create");
    expect(output.item).toMatchObject({ type: "function_call_output", call_id: "c1", output: "saved" });
    expect(typesOf(openAi.sent)).toContain("response.create");
  });

  test("reports an unknown tool rather than going silent", async () => {
    const { openAi } = build();
    openAi.emit("message", { data: toolCall("nonexistent") });
    await Bun.sleep(5);

    const output = openAi.sent.find((m) => m.type === "conversation.item.create");
    expect(output.item.output).toContain("not available");
  });

  test("a throwing tool reports the error and the call continues", async () => {
    const { openAi } = build({
      tools: [
        {
          name: "boom",
          description: "",
          parameters: {},
          handler: async () => {
            throw new Error("handler exploded");
          },
        },
      ],
    } as Partial<CallContext>);

    openAi.emit("message", { data: toolCall("boom") });
    await Bun.sleep(5);

    const output = openAi.sent.find((m) => m.type === "conversation.item.create");
    expect(output.item.output).toContain("handler exploded");
    expect(typesOf(openAi.sent)).toContain("response.create"); // still asked for a reply
  });
});

describe("relay shutdown", () => {
  test("Twilio hanging up ends the call as twilio_stop", async () => {
    const { relay } = build();
    relay.onTwilioMessage(JSON.stringify({ event: "stop" }));
    expect((await relay.completion).endedReason).toBe("twilio_stop");
  });

  test("OpenAI dropping the socket ends the call as openai_close", async () => {
    const { relay, openAi } = build();
    openAi.emit("close");
    expect((await relay.completion).endedReason).toBe("openai_close");
  });

  test("a socket error ends the call and surfaces the message", async () => {
    const { relay, openAi } = build();
    relay.ready.catch(() => {}); // ready rejects; the test is about completion
    openAi.emit("error", { message: "connection refused" });

    const result = await relay.completion;
    expect(result.endedReason).toBe("error");
    expect(result.error).toBe("connection refused");
  });

  test("closes the OpenAI socket when the call ends", async () => {
    const { relay, openAi } = build();
    relay.onTwilioMessage(JSON.stringify({ event: "stop" }));
    await relay.completion;
    expect(openAi.closed).toBe(true);
  });

  test("the first ending wins — a later one cannot rewrite it", async () => {
    const { relay, openAi } = build();
    relay.onTwilioMessage(JSON.stringify({ event: "stop" }));
    openAi.emit("close");
    relay.onTwilioClose();
    expect((await relay.completion).endedReason).toBe("twilio_stop");
  });

  test("winding down runs once even when every end signal fires", async () => {
    const { relay, openAi } = build();
    relay.onTwilioMessage(JSON.stringify({ event: "stop" }));
    openAi.emit("close");
    relay.onTwilioClose();
    await relay.completion;
    // A second teardown would re-close the socket and re-push transcript state.
    expect(openAi.closeCount).toBe(1);
  });
});
