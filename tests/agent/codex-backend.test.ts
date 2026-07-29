import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "fs";
import { CodexBackend, resolveCodexBin, type CliProc, type SpawnFn } from "../../src/agent/backends/codex";
import { startMcpEndpoint, stopMcpEndpoint, liveRunCount } from "../../src/agent/mcp-endpoint";
import type { AgentEvent, AgentSessionContext } from "../../src/agent/types";

/** A fake CLI process emitting scripted JSONL lines, then exiting. */
function fakeProc(lines: string[], exitCode = 0, stderrText = ""): CliProc {
  const stdout = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(lines.join("\n") + "\n"));
      controller.close();
    },
  });
  const stderr = new ReadableStream<Uint8Array>({
    start(controller) {
      if (stderrText) controller.enqueue(new TextEncoder().encode(stderrText));
      controller.close();
    },
  });
  return { stdout, stderr, exited: Promise.resolve(exitCode), kill: () => {} };
}

const CTX: AgentSessionContext = {
  room: "job/x",
  channel: "system",
  systemPrompt: "sys",
  cwd: "/tmp",
  resume: false,
  source: { jobName: "x", channel: "system" },
};

async function collect(stream: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const ev of stream) out.push(ev);
  return out;
}

beforeAll(async () => {
  await startMcpEndpoint();
});
afterAll(() => stopMcpEndpoint());

describe("resolveCodexBin", () => {
  test("resolves to an absolute path that exists, or the bare 'codex' fallback", () => {
    const bin = resolveCodexBin();
    expect(typeof bin).toBe("string");
    expect(bin.length).toBeGreaterThan(0);
    // If it resolved an absolute path (not the PATH fallback), the file must exist.
    if (bin !== "codex") expect(existsSync(bin)).toBe(true);
  });
});

/**
 * A process whose exit only resolves once stderr has been read — the shape of a
 * real OS pipe, which blocks the child when its buffer fills and nobody drains.
 */
function stderrGatedProc(lines: string[], stderrText: string): CliProc {
  let release!: () => void;
  const drained = new Promise<void>((r) => (release = r));
  return {
    stdout: new ReadableStream<Uint8Array>({
      start(c) {
        if (lines.length) c.enqueue(new TextEncoder().encode(lines.join("\n") + "\n"));
        c.close();
      },
    }),
    stderr: new ReadableStream<Uint8Array>(
      {
        pull(c) {
          c.enqueue(new TextEncoder().encode(stderrText));
          c.close();
          release();
        },
      },
      { highWaterMark: 0 }, // pull only on a real read, so the gate models a blocked pipe
    ),
    exited: drained.then(() => 1),
    kill: () => {},
  };
}

describe("CodexSession process handling", () => {
  test("drains stderr while the process runs instead of after it exits", async () => {
    const spawnFn: SpawnFn = () => stderrGatedProc([], "boom: something broke");
    const session = await new CodexBackend({ spawnFn }).openSession(CTX);

    const events = await Promise.race([
      collect(session.send("x")),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("deadlocked on stderr")), 2000)),
    ]);

    const err = events.at(-1)!;
    expect(err.type).toBe("error");
    if (err.type === "error") expect(err.message).toContain("boom");
  });

  test("kills a codex that goes silent and reports it as provider-scoped", async () => {
    let killed = false;
    const spawnFn: SpawnFn = () => ({
      stdout: new ReadableStream<Uint8Array>({ start() {} }), // never emits, never closes
      stderr: new ReadableStream<Uint8Array>({ start: (c) => c.close() }),
      exited: new Promise<number>(() => {}),
      kill: () => {
        killed = true;
      },
    });
    const session = await new CodexBackend({ spawnFn, idleTimeoutMs: 50 }).openSession(CTX);
    const events = await collect(session.send("x"));

    expect(killed).toBe(true);
    const err = events.at(-1)!;
    expect(err.type).toBe("error");
    if (err.type === "error") {
      expect(err.message).toContain("no output");
      expect(err.failover).toBe("provider");
    }
  });
});

describe("codex subprocess environment", () => {
  test("passes through what the CLI needs and nothing else", async () => {
    process.env.OPENAI_API_KEY = "sk-should-not-leak";
    process.env.GITHUB_TOKEN = "ghp-should-not-leak";
    let env: Record<string, string> = {};
    const spawnFn: SpawnFn = (_args, opts) => {
      env = opts.env;
      return fakeProc([JSON.stringify({ type: "turn.completed", usage: {} })]);
    };
    const session = await new CodexBackend({ spawnFn }).openSession(CTX);
    await collect(session.send("x"));
    delete process.env.OPENAI_API_KEY;
    delete process.env.GITHUB_TOKEN;

    expect(env.PATH).toBeDefined();
    expect(env.HOME).toBeDefined();
    expect(env.NIA_MCP_TOKEN).toBeDefined();
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.GITHUB_TOKEN).toBeUndefined();
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.DATABASE_URL).toBeUndefined();
  });
});

describe("CodexSession", () => {
  test("normalizes a codex run to session → text → result and revokes the token", async () => {
    const before = liveRunCount();
    const spawnFn: SpawnFn = (args) => {
      // sanity: the mcp endpoint url + bearer env var are wired into the args
      expect(args.join(" ")).toContain("mcp_servers.nia.url=");
      expect(args.join(" ")).toContain("bearer_token_env_var");
      return fakeProc([
        JSON.stringify({ type: "thread.started", thread_id: "tid-7" }),
        JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "done" } }),
        JSON.stringify({ type: "turn.completed", usage: { input_tokens: 10, output_tokens: 2 } }),
      ]);
    };
    const session = await new CodexBackend({ spawnFn }).openSession(CTX);
    const events = await collect(session.send("do the thing"));

    expect(events.map((e) => e.type)).toEqual(["session", "text", "result"]);
    expect(session.backendSessionId).toBe("tid-7");
    const result = events.at(-1)!;
    if (result.type === "result") {
      expect(result.text).toBe("done");
      expect(result.usage.tokens).toEqual({ input: 10, output: 2 });
    }
    // token revoked after the run (no leak)
    expect(liveRunCount()).toBe(before);
    await session.close();
  });

  test("a non-zero exit with no result yields an error event", async () => {
    const spawnFn: SpawnFn = () => fakeProc([JSON.stringify({ type: "thread.started", thread_id: "t" })], 1);
    const session = await new CodexBackend({ spawnFn }).openSession(CTX);
    const events = await collect(session.send("x"));
    expect(events.at(-1)?.type).toBe("error");
  });

  test("an expired auth session is reported as provider-down so the chain fails over", async () => {
    const spawnFn: SpawnFn = () =>
      fakeProc([], 1, "Failed to authenticate: OAuth session expired and could not be refreshed");
    const session = await new CodexBackend({ spawnFn }).openSession(CTX);
    const events = await collect(session.send("x"));
    const err = events.at(-1)!;
    expect(err.type).toBe("error");
    if (err.type === "error") expect(err.failover).toBe("provider");
  });

  // Codex prints "Reading additional input from stdin..." to stderr on every
  // non-TTY run, so a structured failure must never be reported as that notice.
  test("a structured turn failure surfaces the provider's message, not the stderr notice", async () => {
    const envelope =
      '{"type":"error","status":400,"error":{"type":"invalid_request_error","message":"The \'claude-sonnet-5\' model is not supported when using Codex with a ChatGPT account."}}';
    const spawnFn: SpawnFn = () =>
      fakeProc(
        [
          JSON.stringify({ type: "thread.started", thread_id: "tid-400" }),
          JSON.stringify({ type: "error", message: envelope }),
          JSON.stringify({ type: "turn.failed", error: { message: envelope } }),
        ],
        1,
        "Reading additional input from stdin...\n",
      );
    const session = await new CodexBackend({ spawnFn }).openSession(CTX);
    const events = await collect(session.send("x"));

    expect(events.filter((e) => e.type === "error")).toHaveLength(1);
    const err = events.at(-1)!;
    expect(err.type).toBe("error");
    if (err.type === "error") {
      expect(err.message).toBe(
        "The 'claude-sonnet-5' model is not supported when using Codex with a ChatGPT account.",
      );
      expect(err.failover).toBe("model");
    }
  });

  test("a genuine task failure is not reported as provider-down", async () => {
    const spawnFn: SpawnFn = () => fakeProc([], 1, "error: no such file or directory (os error 2)");
    const session = await new CodexBackend({ spawnFn }).openSession(CTX);
    const events = await collect(session.send("x"));
    const err = events.at(-1)!;
    expect(err.type).toBe("error");
    if (err.type === "error") expect(err.failover).toBeUndefined();
  });
});
