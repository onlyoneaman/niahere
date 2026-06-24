import { describe, expect, test } from "bun:test";
import { isResultEvent, type AgentEvent } from "../../src/agent/types";

describe("AgentEvent", () => {
  test("isResultEvent narrows a result event", () => {
    const ev: AgentEvent = { type: "result", text: "ok", usage: { costUsd: 0.01, turns: 1 }, backendSessionId: "s1" };
    expect(isResultEvent(ev)).toBe(true);
    if (isResultEvent(ev)) expect(ev.text).toBe("ok");
  });

  test("isResultEvent rejects non-result events", () => {
    const t: AgentEvent = { type: "text", delta: "hi" };
    const e: AgentEvent = { type: "error", message: "boom", retryable: false, providerDown: true };
    expect(isResultEvent(t)).toBe(false);
    expect(isResultEvent(e)).toBe(false);
  });

  test("error event carries retryable and providerDown independently", () => {
    const transient: AgentEvent = { type: "error", message: "529", retryable: true, providerDown: false };
    const down: AgentEvent = { type: "error", message: "", retryable: false, providerDown: true };
    expect(transient).toMatchObject({ retryable: true, providerDown: false });
    expect(down).toMatchObject({ retryable: false, providerDown: true });
  });
});
