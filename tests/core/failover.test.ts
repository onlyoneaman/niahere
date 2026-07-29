import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { runJobAcrossChain } from "../../src/core/runner";
import { CodexBackend, type CliProc, type SpawnFn } from "../../src/agent/backends/codex";
import { startMcpEndpoint, stopMcpEndpoint } from "../../src/agent/mcp-endpoint";
import type { AgentBackend, AgentEvent, AgentSessionContext } from "../../src/agent";

function fakeBackend(name: AgentBackend["name"], events: AgentEvent[], seenModels?: (string | undefined)[]): AgentBackend {
  return {
    name,
    async openSession(ctx) {
      seenModels?.push(ctx.model);
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

/** A backend that cannot even start — e.g. codex is not installed. */
function throwingBackend(name: AgentBackend["name"]): AgentBackend {
  return {
    name,
    async openSession() {
      throw new Error("spawn codex ENOENT");
    },
    async canResume() {
      return false;
    },
  };
}

const DOWN: AgentEvent[] = [{ type: "error", message: "", retryable: false, failover: "provider" }];
const MODEL_GONE: AgentEvent[] = [
  { type: "error", message: "model not found: x", retryable: false, failover: "model" },
];
const OK = (id: string): AgentEvent[] => [
  { type: "session", backendSessionId: id },
  { type: "result", text: "ok", usage: { tokens: { input: 1, output: 1 } }, backendSessionId: id },
];

const CTX: AgentSessionContext = { room: "job/x", channel: "system", systemPrompt: "s", cwd: "/tmp", resume: false };

describe("runJobAcrossChain (failover)", () => {
  test("fails over to the next entry when the primary provider is down", async () => {
    const chain = [
      { backend: fakeBackend("claude", DOWN) },
      { backend: fakeBackend("codex", OK("c1")), model: "gpt-5-codex" },
    ];
    const out = await runJobAcrossChain(chain, CTX, "do it");
    expect(out.agentText).toBe("ok");
    expect(out.failover).toBeUndefined();
  });

  test("does not fail over when the primary succeeds", async () => {
    let fallbackTried = false;
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
    const out = await runJobAcrossChain(
      [{ backend: fakeBackend("claude", OK("p1")) }, { backend: fallback }],
      CTX,
      "do it",
    );
    expect(out.agentText).toBe("ok");
    expect(fallbackTried).toBe(false);
  });

  test("a model-scoped failure tries the next model on the SAME provider", async () => {
    const seen: (string | undefined)[] = [];
    const chain = [
      { backend: fakeBackend("claude", MODEL_GONE, seen), model: "opus" },
      { backend: fakeBackend("claude", OK("s1"), seen), model: "sonnet" },
    ];
    const out = await runJobAcrossChain(chain, CTX, "do it");
    expect(out.agentText).toBe("ok");
    expect(seen).toEqual(["opus", "sonnet"]);
  });

  test("a provider-scoped failure skips every remaining entry for that provider", async () => {
    const seen: (string | undefined)[] = [];
    const chain = [
      { backend: fakeBackend("claude", DOWN, seen), model: "opus" },
      { backend: fakeBackend("claude", OK("s1"), seen), model: "sonnet" },
      { backend: fakeBackend("codex", OK("c1"), seen), model: "gpt-5-codex" },
    ];
    const out = await runJobAcrossChain(chain, CTX, "do it");
    expect(out.agentText).toBe("ok");
    expect(seen).toEqual(["opus", "gpt-5-codex"]); // sonnet never attempted
  });

  test("a genuine task failure stops the chain", async () => {
    const failed: AgentEvent[] = [{ type: "error", message: "the tests did not pass", retryable: false }];
    let nextTried = false;
    const next: AgentBackend = {
      name: "codex",
      async openSession() {
        nextTried = true;
        return { backendSessionId: null, async *send() {}, abort() {}, async close() {} };
      },
      async canResume() {
        return false;
      },
    };
    const out = await runJobAcrossChain([{ backend: fakeBackend("claude", failed) }, { backend: next }], CTX, "x");
    expect(nextTried).toBe(false);
    expect(out.error).toBe("the tests did not pass");
  });

  test("a backend that cannot start advances the chain instead of killing the run", async () => {
    const out = await runJobAcrossChain(
      [{ backend: throwingBackend("codex") }, { backend: fakeBackend("claude", OK("c1")) }],
      CTX,
      "do it",
    );
    expect(out.agentText).toBe("ok");
  });

  test("hands each entry its own model", async () => {
    const seen: (string | undefined)[] = [];
    await runJobAcrossChain([{ backend: fakeBackend("claude", OK("p1"), seen), model: "claude-sonnet-5" }], CTX, "x");
    expect(seen).toEqual(["claude-sonnet-5"]);
  });

  test("returns the last result when every entry fails over", async () => {
    const out = await runJobAcrossChain(
      [{ backend: fakeBackend("claude", DOWN) }, { backend: fakeBackend("codex", DOWN) }],
      CTX,
      "x",
    );
    expect(out.failover).toBe("provider");
    expect(out.error).toBe("");
  });
});

/** A codex CLI that exits non-zero having written `stderr` and no result. */
function failingCodexProc(stderr: string): CliProc {
  return {
    stdout: new ReadableStream<Uint8Array>({ start: (c) => c.close() }),
    stderr: new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode(stderr));
        c.close();
      },
    }),
    exited: Promise.resolve(1),
    kill: () => {},
  };
}

describe("runJobAcrossChain (codex in the chain)", () => {
  beforeAll(async () => {
    await startMcpEndpoint();
  });
  afterAll(() => stopMcpEndpoint());

  test("a codex auth failure fails over to the next backend instead of ending the chain", async () => {
    const spawnFn: SpawnFn = () =>
      failingCodexProc("Failed to authenticate: OAuth session expired and could not be refreshed");
    const codex = new CodexBackend({ spawnFn });
    const last = fakeBackend("gemini", OK("g1"));

    const out = await runJobAcrossChain([{ backend: fakeBackend("claude", DOWN) }, { backend: codex }, { backend: last }], CTX, "do it");

    expect(out.agentText).toBe("ok");
  });

  test("a genuine codex task failure ends the chain rather than replaying on the next backend", async () => {
    let lastTried = false;
    const spawnFn: SpawnFn = () => failingCodexProc("error: no such file or directory (os error 2)");
    const last: AgentBackend = {
      name: "gemini",
      async openSession() {
        lastTried = true;
        return { backendSessionId: null, async *send() {}, abort() {}, async close() {} };
      },
      async canResume() {
        return false;
      },
    };

    const out = await runJobAcrossChain([{ backend: new CodexBackend({ spawnFn }) }, { backend: last }], CTX, "do it");

    expect(lastTried).toBe(false);
    expect(out.error).toContain("no such file or directory");
  });
});
