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
});
