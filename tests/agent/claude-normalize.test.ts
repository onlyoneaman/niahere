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

  test("transient error → retryable, NOT providerDown", () => {
    const n = new SdkNormalizer();
    expect(n.consume({ type: "result", is_error: true, errors: ["overloaded_error"] })).toEqual([
      { type: "error", message: "overloaded_error", retryable: true, providerDown: false },
    ]);
  });

  test("blank/unknown error → providerDown, NOT retryable", () => {
    const n = new SdkNormalizer();
    expect(n.consume({ type: "result", is_error: true, errors: [] })).toEqual([
      { type: "error", message: "unknown error", retryable: false, providerDown: true },
    ]);
  });

  test("specific non-transient error → neither retryable nor providerDown", () => {
    const n = new SdkNormalizer();
    expect(n.consume({ type: "result", is_error: true, errors: ["oauth_org_not_allowed"] })).toEqual([
      { type: "error", message: "oauth_org_not_allowed", retryable: false, providerDown: false },
    ]);
  });
});
