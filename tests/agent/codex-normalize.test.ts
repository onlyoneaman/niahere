import { describe, expect, test } from "bun:test";
import { CodexNormalizer } from "../../src/agent/backends/codex-normalize";
import type { AgentEvent } from "../../src/agent/types";

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
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      type: "result",
      text: "the answer",
      usage: { tokens: { input: 95, output: 20 } },
      backendSessionId: "tid-9",
    });
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

describe("CodexNormalizer usage attribution", () => {
  const turn = (model?: string, usage?: Record<string, number>) => {
    const n = new CodexNormalizer(model);
    n.consume({ type: "thread.started", thread_id: "t1" });
    return n.consume({
      type: "turn.completed",
      usage: usage ?? { input_tokens: 100, cached_input_tokens: 40, output_tokens: 7 },
    })[0]!;
  };

  const usageOf = (ev: AgentEvent, model = "gpt-5-codex") =>
    (ev as { metadata?: { model_usage?: Record<string, Record<string, unknown>> } }).metadata!.model_usage![model]!;

  test("reports its provider so a failed-over turn is attributable", () => {
    const ev = turn("gpt-5-codex");
    expect(ev.type).toBe("result");
    if (ev.type !== "result") return;
    const usage = usageOf(ev);
    expect(usage.provider).toBe("codex");
    expect(usage.outputTokens).toBe(7);
  });

  test("cached input is not counted twice", () => {
    // Codex follows OpenAI's shape: `input_tokens` is the whole prompt and
    // `cached_input_tokens` is the cached slice of it. Claude reports the two
    // as siblings, and one accumulator sums both — so the slice has to come
    // out or every codex turn inflates its own prompt.
    const ev = turn("gpt-5-codex");
    if (ev.type !== "result") return;
    const usage = usageOf(ev);
    expect(usage.inputTokens).toBe(60);
    expect(usage.cacheReadInputTokens).toBe(40);
  });

  test("a cached count larger than the prompt never yields negative tokens", () => {
    const ev = turn("gpt-5-codex", { input_tokens: 10, cached_input_tokens: 40, output_tokens: 1 });
    if (ev.type !== "result") return;
    expect(usageOf(ev).inputTokens).toBe(0);
  });

  test("cache writes are recorded, not discarded", () => {
    const ev = turn("gpt-5-codex", {
      input_tokens: 100,
      cached_input_tokens: 40,
      cache_write_input_tokens: 25,
      output_tokens: 7,
    });
    if (ev.type !== "result") return;
    expect(usageOf(ev).cacheCreationInputTokens).toBe(25);
  });

  test("claims no cost, because codex reports none", () => {
    // A missing cost must not read as a free turn: the accumulator counts it
    // as unpriced instead of adding zero.
    const ev = turn("gpt-5-codex");
    if (ev.type !== "result") return;
    expect(ev.metadata?.cost_usd).toBeUndefined();
    expect(usageOf(ev).costUSD).toBeUndefined();
  });

  test("a run on codex's own default is still attributed", () => {
    const ev = turn(undefined);
    if (ev.type !== "result") return;
    const entry = Object.entries(ev.metadata?.model_usage as Record<string, Record<string, unknown>>)[0]!;
    expect(entry[0]).toBe("default");
    expect(entry[1].provider).toBe("codex");
  });

  test("still reports the normalized token totals on the event itself", () => {
    const ev = turn("gpt-5-codex");
    if (ev.type !== "result") return;
    expect(ev.usage.tokens).toEqual({ input: 60, output: 7 });
  });
});
