import { describe, expect, test } from "bun:test";
import { runJobAcrossBackends } from "../../src/core/runner";
import type { AgentBackend, AgentEvent, AgentSessionContext } from "../../src/agent";

function fakeBackend(name: AgentBackend["name"], events: AgentEvent[]): AgentBackend {
  return {
    name,
    async openSession() {
      return {
        backendSessionId: null,
        async *send(): AsyncIterable<AgentEvent> {
          for (const e of events) yield e;
        },
        abort() {},
        async close() {},
      };
    },
    async canResume() {
      return false;
    },
  };
}

const DOWN: AgentEvent[] = [{ type: "error", message: "", retryable: false, providerDown: true }];
const OK = (id: string): AgentEvent[] => [
  { type: "session", backendSessionId: id },
  { type: "result", text: "ok", usage: { tokens: { input: 1, output: 1 } }, backendSessionId: id },
];

const CTX: AgentSessionContext = { room: "job/x", channel: "system", systemPrompt: "s", cwd: "/tmp", resume: false };

describe("runJobAcrossBackends (failover)", () => {
  test("fails over to the next backend when the primary is provider-down", async () => {
    const primary = fakeBackend("claude", DOWN);
    const fallback = fakeBackend("codex", OK("c1"));
    const out = await runJobAcrossBackends([primary, fallback], CTX, "do it");
    expect(out.agentText).toBe("ok");
    expect(out.providerDown).toBeFalsy();
  });

  test("does not fail over when the primary succeeds", async () => {
    let fallbackTried = false;
    const primary = fakeBackend("claude", OK("p1"));
    const fallback: AgentBackend = {
      name: "codex",
      async openSession() {
        fallbackTried = true;
        return { backendSessionId: null, async *send() {}, abort() {}, async close() {} };
      },
      async canResume() {
        return false;
      },
    };
    const out = await runJobAcrossBackends([primary, fallback], CTX, "do it");
    expect(out.agentText).toBe("ok");
    expect(fallbackTried).toBe(false);
  });

  test("returns the last provider-down result when all backends are down", async () => {
    const out = await runJobAcrossBackends([fakeBackend("claude", DOWN), fakeBackend("codex", DOWN)], CTX, "x");
    expect(out.providerDown).toBe(true);
    expect(out.error).toBe("");
  });
});
