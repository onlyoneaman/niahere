import { describe, expect, test } from "bun:test";
import { SdkNormalizer } from "../../src/agent/backends/claude-normalize";

describe("SdkNormalizer", () => {
  test("init → session event", () => {
    const n = new SdkNormalizer();
    expect(n.consume({ type: "system", subtype: "init", session_id: "s1" })).toEqual([
      { type: "session", backendSessionId: "s1" },
    ]);
  });

  test("text_delta → text event (raw chunk; consumer accumulates)", () => {
    const n = new SdkNormalizer();
    const a = n.consume({
      type: "stream_event",
      event: { type: "content_block_delta", delta: { type: "text_delta", text: "He" } },
    });
    const b = n.consume({
      type: "stream_event",
      event: { type: "content_block_delta", delta: { type: "text_delta", text: "llo" } },
    });
    expect(a).toEqual([{ type: "text", delta: "He" }]);
    expect(b).toEqual([{ type: "text", delta: "llo" }]);
  });

  test("thinking block start emits 'thinking...'; delta emits only on newline boundary", () => {
    const n = new SdkNormalizer();
    expect(
      n.consume({ type: "stream_event", event: { type: "content_block_start", content_block: { type: "thinking" } } }),
    ).toEqual([{ type: "thinking", delta: "thinking..." }]);
    expect(
      n.consume({
        type: "stream_event",
        event: { type: "content_block_delta", delta: { type: "thinking_delta", thinking: "first line" } },
      }),
    ).toEqual([]);
    expect(
      n.consume({
        type: "stream_event",
        event: { type: "content_block_delta", delta: { type: "thinking_delta", thinking: "\nsecond" } },
      }),
    ).toEqual([{ type: "thinking", delta: "first line" }]);
  });

  test("tool_use_summary → tool event using the SDK's human summary", () => {
    const n = new SdkNormalizer();
    // Real SDK shape: { summary, preceding_tool_use_ids } — no tool_name/tool_input.
    const out = n.consume({ type: "tool_use_summary", summary: "Read foo.ts", preceding_tool_use_ids: [] });
    expect(out).toEqual([{ type: "tool", name: "tool", summary: "Read foo.ts" }]);
  });

  test("tool_progress carries no displayable content → no event", () => {
    const n = new SdkNormalizer();
    expect(n.consume({ type: "tool_progress", tool_name: "Bash", tool_use_id: "t", elapsed_time_seconds: 1 })).toEqual(
      [],
    );
  });

  test("successful result → result event with usage + metadata", () => {
    const n = new SdkNormalizer();
    const out = n.consume({
      type: "result",
      is_error: false,
      result: "answer",
      total_cost_usd: 0.02,
      num_turns: 3,
      terminal_reason: "end_turn",
      session_id: "s9",
      usage: { foo: 1 },
    });
    expect(out).toHaveLength(1);
    const ev = out[0]!;
    expect(ev.type).toBe("result");
    if (ev.type === "result") {
      expect(ev.text).toBe("answer");
      expect(ev.usage).toEqual({ costUsd: 0.02, turns: 3 });
      expect(ev.backendSessionId).toBe("s9");
      expect(ev.metadata?.cost_usd).toBe(0.02);
      expect(ev.metadata?.terminal_reason).toBe("end_turn");
    }
  });

  test("model_usage names the backend, not the SDK's deployment target", () => {
    // The SDK's own `provider` is firstParty/bedrock/vertex — a different axis
    // from the chain's identity, and the only one the codex path reports.
    const n = new SdkNormalizer();
    const out = n.consume({
      type: "result",
      is_error: false,
      result: "answer",
      session_id: "s9",
      modelUsage: {
        "claude-sonnet-5": { provider: "firstParty", inputTokens: 10, outputTokens: 2, cacheReadInputTokens: 900 },
      },
    });
    const ev = out[0]!;
    if (ev.type !== "result") throw new Error("expected result");
    expect(ev.metadata?.model_usage).toEqual({
      "claude-sonnet-5": { provider: "claude", inputTokens: 10, outputTokens: 2, cacheReadInputTokens: 900 },
    });
  });

  test("every model on a turn is attributed, not just the first", () => {
    const n = new SdkNormalizer();
    const out = n.consume({
      type: "result",
      is_error: false,
      result: "answer",
      modelUsage: {
        "claude-sonnet-5": { provider: "firstParty", inputTokens: 10 },
        "claude-haiku-4-5": { inputTokens: 3 },
      },
    });
    const ev = out[0]!;
    if (ev.type !== "result") throw new Error("expected result");
    const usage = ev.metadata?.model_usage as Record<string, { provider: string }>;
    expect(Object.values(usage).map((u) => u.provider)).toEqual(["claude", "claude"]);
  });

  test("a turn the SDK reported no model usage for stays absent", () => {
    const n = new SdkNormalizer();
    const out = n.consume({ type: "result", is_error: false, result: "answer" });
    const ev = out[0]!;
    if (ev.type !== "result") throw new Error("expected result");
    expect(ev.metadata?.model_usage).toBeUndefined();
  });

  test("transient error → retryable, no failover yet", () => {
    const n = new SdkNormalizer();
    expect(n.consume({ type: "result", is_error: true, errors: ["overloaded_error"] })).toEqual([
      { type: "error", message: "overloaded_error", retryable: true, terminalReason: undefined },
    ]);
  });

  test("blank/unknown error → provider-scoped failover, NOT retryable", () => {
    const n = new SdkNormalizer();
    expect(n.consume({ type: "result", is_error: true, errors: [] })).toEqual([
      { type: "error", message: "unknown error", retryable: false, failover: "provider", terminalReason: undefined },
    ]);
  });

  test("a rejected model is model-scoped so the chain tries the next model", () => {
    const n = new SdkNormalizer();
    const out = n.consume({ type: "result", is_error: true, errors: ["model not found: gpt-5-codex"] });
    expect(out[0]).toMatchObject({ type: "error", failover: "model" });
  });

  test("specific non-transient error → no failover, the chain stops", () => {
    const n = new SdkNormalizer();
    expect(n.consume({ type: "result", is_error: true, errors: ["oauth_org_not_allowed"] })).toEqual([
      { type: "error", message: "oauth_org_not_allowed", retryable: false, terminalReason: undefined },
    ]);
  });
});

describe("SdkNormalizer — result classification", () => {
  const result = (over: Record<string, unknown>) =>
    new SdkNormalizer().consume({ type: "result", session_id: "s1", result: "", ...over })[0]!;

  test("an HTTP status decides the scope, not the prose", () => {
    // 429/529 arrive with unhelpful text; the status is the reliable signal.
    expect(result({ is_error: true, errors: ["something went wrong"], api_error_status: 429 })).toMatchObject({
      type: "error",
      failover: "provider",
    });
    expect(result({ is_error: true, errors: [""], api_error_status: 529 })).toMatchObject({ failover: "provider" });
  });

  test("a rejected model is model-scoped so the chain tries the next model", () => {
    expect(result({ is_error: true, errors: ["no such model"], api_error_status: 404 })).toMatchObject({
      failover: "model",
    });
  });

  test("a plain bad request stops the chain", () => {
    expect(result({ is_error: true, errors: ["your prompt was malformed"], api_error_status: 400 })).toMatchObject({
      type: "error",
      failover: undefined,
    });
  });

  test("without a status it still falls back to prose", () => {
    expect(result({ is_error: true, errors: [] })).toMatchObject({ failover: "provider" });
  });

  // Turns that die on an exhausted retry used to arrive as terminal_reason
  // "completed"; the SDK now names them, and a named dead turn is not a success.
  test("a turn that died on an API error is an error, not a completed result", () => {
    const ev = result({ is_error: false, terminal_reason: "api_error" });
    expect(ev.type).toBe("error");
    if (ev.type === "error") expect(ev.failover).toBe("provider");
  });

  test("a turn that exhausted its budget is a real failure that stops the chain", () => {
    const ev = result({ is_error: false, terminal_reason: "budget_exhausted" });
    expect(ev.type).toBe("error");
    if (ev.type === "error") expect(ev.failover).toBeUndefined();
  });

  test.each(["malformed_tool_use_exhausted", "structured_output_retry_exhausted", "turn_setup_failed"])(
    "%s is reported as a failure",
    (reason) => {
      expect(result({ is_error: false, terminal_reason: reason }).type).toBe("error");
    },
  );

  test("a genuinely completed turn is still a result", () => {
    const ev = result({ is_error: false, terminal_reason: "completed", result: "done" });
    expect(ev.type).toBe("result");
    if (ev.type === "result") expect(ev.text).toBe("done");
  });

  test("a turn stopped by max_turns is still a result, not a failure", () => {
    // A real completion boundary, not a dead turn — the caller reads terminalReason.
    expect(result({ is_error: false, terminal_reason: "max_turns", result: "partial" }).type).toBe("result");
  });
});

// Compaction happens silently in long sessions; without this it is invisible.
describe("SdkNormalizer — compaction", () => {
  const boundary = (meta: Record<string, unknown>) =>
    new SdkNormalizer().consume({ type: "system", subtype: "compact_boundary", compact_metadata: meta });

  test("surfaces an automatic compaction as activity", () => {
    const out = boundary({ trigger: "auto", pre_tokens: 152000, post_tokens: 41000 });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ type: "thinking" });
    if (out[0]!.type === "thinking") {
      expect(out[0].delta).toContain("compacted");
      expect(out[0].delta).toContain("152000");
    }
  });

  test("distinguishes a manual compaction", () => {
    const out = boundary({ trigger: "manual", pre_tokens: 90000 });
    if (out[0]!.type === "thinking") expect(out[0].delta).toContain("manual");
  });

  test("copes with a boundary that carries no metadata", () => {
    expect(() => new SdkNormalizer().consume({ type: "system", subtype: "compact_boundary" })).not.toThrow();
    expect(new SdkNormalizer().consume({ type: "system", subtype: "compact_boundary" })).toHaveLength(1);
  });

  test("other system subtypes are still ignored", () => {
    expect(new SdkNormalizer().consume({ type: "system", subtype: "something_else" })).toEqual([]);
  });
});
