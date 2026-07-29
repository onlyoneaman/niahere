import { describe, expect, test } from "bun:test";
import { CodexNormalizer } from "../../src/agent/backends/codex-normalize";

// Event shapes captured from real codex 0.142.0 `codex exec --json`.
describe("CodexNormalizer", () => {
  test("thread.started → session event with thread id", () => {
    const n = new CodexNormalizer();
    expect(n.consume({ type: "thread.started", thread_id: "tid-1" })).toEqual([
      { type: "session", backendSessionId: "tid-1" },
    ]);
  });

  test("command_execution start → tool activity (once)", () => {
    const n = new CodexNormalizer();
    expect(
      n.consume({ type: "item.started", item: { id: "i1", type: "command_execution", command: "ls -la" } }),
    ).toEqual([{ type: "tool", name: "command", summary: "ls -la" }]);
    // completed does not re-emit
    expect(
      n.consume({ type: "item.completed", item: { id: "i1", type: "command_execution", command: "ls -la" } }),
    ).toEqual([]);
  });

  test("agent_message completed → text with the full message", () => {
    const n = new CodexNormalizer();
    expect(n.consume({ type: "item.completed", item: { id: "i2", type: "agent_message", text: "hello" } })).toEqual([
      { type: "text", delta: "hello" },
    ]);
  });

  test("turn.completed → result with accumulated text + token usage", () => {
    const n = new CodexNormalizer();
    n.consume({ type: "thread.started", thread_id: "tid-9" });
    n.consume({ type: "item.completed", item: { type: "agent_message", text: "the answer" } });
    const out = n.consume({
      type: "turn.completed",
      usage: { input_tokens: 100, output_tokens: 20, cached_input_tokens: 5 },
    });
    expect(out).toEqual([
      {
        type: "result",
        text: "the answer",
        usage: { tokens: { input: 100, output: 20 } },
        backendSessionId: "tid-9",
      },
    ]);
  });

  test("non-fatal error items and unknown events are ignored", () => {
    const n = new CodexNormalizer();
    expect(n.consume({ type: "item.completed", item: { type: "error", message: "skills shortened" } })).toEqual([]);
    expect(n.consume({ type: "turn.started" })).toEqual([]);
  });

  // Captured from real codex 0.145.0: a rejected request arrives as a top-level
  // `error` followed by `turn.failed`, both carrying a JSON-encoded API envelope.
  const API_400 =
    '{"type":"error","status":400,"error":{"type":"invalid_request_error","message":"The \'claude-sonnet-5\' model is not supported when using Codex with a ChatGPT account."}}';

  test("a top-level error ends the turn with the provider's message unwrapped", () => {
    const n = new CodexNormalizer();
    expect(n.consume({ type: "error", message: API_400 })).toEqual([
      {
        type: "error",
        message: "The 'claude-sonnet-5' model is not supported when using Codex with a ChatGPT account.",
        retryable: false,
        failover: "model",
      },
    ]);
  });

  test("turn.failed ends the turn when no top-level error preceded it", () => {
    const n = new CodexNormalizer();
    const out = n.consume({ type: "turn.failed", error: { message: "upstream connection reset" } });
    expect(out).toEqual([
      { type: "error", message: "upstream connection reset", retryable: false, failover: "provider" },
    ]);
  });

  test("turn.failed after a top-level error does not emit a second error", () => {
    const n = new CodexNormalizer();
    expect(n.consume({ type: "error", message: API_400 })).toHaveLength(1);
    expect(n.consume({ type: "turn.failed", error: { message: API_400 } })).toEqual([]);
  });

  test("a non-JSON failure message passes through as-is", () => {
    const n = new CodexNormalizer();
    const out = n.consume({ type: "turn.failed", error: { message: "the task could not be completed" } });
    expect(out[0]).toMatchObject({ type: "error", message: "the task could not be completed" });
  });
});
