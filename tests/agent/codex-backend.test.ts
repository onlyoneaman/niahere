import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { CodexBackend, type CliProc, type SpawnFn } from "../../src/agent/backends/codex";
import { startMcpEndpoint, stopMcpEndpoint, liveRunCount } from "../../src/agent/mcp-endpoint";
import type { AgentEvent, AgentSessionContext } from "../../src/agent/types";

/** A fake CLI process emitting scripted JSONL lines, then exiting. */
function fakeProc(lines: string[], exitCode = 0): CliProc {
  const stdout = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(lines.join("\n") + "\n"));
      controller.close();
    },
  });
  const stderr = new ReadableStream<Uint8Array>({ start: (c) => c.close() });
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
});
