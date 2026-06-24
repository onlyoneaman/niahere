import { describe, expect, test } from "bun:test";
import { ClaudeBackend, type QueryHandle } from "../../src/agent/backends/claude";
import type { AgentEvent, AgentSessionContext } from "../../src/agent/types";

/** A fake query handle that yields scripted SDK messages then stays paused
 *  (mirrors the real query, which doesn't end after a result). */
function scriptedHandle(messages: unknown[]): QueryHandle {
  let i = 0;
  const iter: AsyncIterator<unknown> = {
    async next() {
      if (i < messages.length) return { value: messages[i++], done: false };
      // After the script, pause forever (the real subprocess waits for input).
      return new Promise(() => {}) as Promise<IteratorResult<unknown>>;
    },
  };
  return Object.assign({ [Symbol.asyncIterator]: () => iter }, { close() {} });
}

const CTX: AgentSessionContext & { retryDelaysMs?: number[] } = {
  room: "r",
  channel: "test",
  systemPrompt: "sys",
  cwd: "/tmp",
  model: "default",
  resume: false,
  retryDelaysMs: [0, 0],
};

async function collect(stream: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const ev of stream) out.push(ev);
  return out;
}

describe("ClaudeSession", () => {
  test("send streams session → text → result", async () => {
    const backend = new ClaudeBackend({
      queryFn: () =>
        scriptedHandle([
          { type: "system", subtype: "init", session_id: "s1" },
          { type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "hi" } } },
          { type: "result", is_error: false, result: "hi", total_cost_usd: 0.01, num_turns: 1, session_id: "s1" },
        ]),
    });
    const session = await backend.openSession(CTX);
    const events = await collect(session.send("hello"));

    expect(events.map((e) => e.type)).toEqual(["session", "text", "result"]);
    expect(session.backendSessionId).toBe("s1");
    const result = events.at(-1)!;
    if (result.type === "result") expect(result.text).toBe("hi");
    await session.close();
  });

  test("retryable error retries internally and emits exactly ONE session event", async () => {
    let call = 0;
    const backend = new ClaudeBackend({
      queryFn: () => {
        call++;
        return call === 1
          ? scriptedHandle([
              { type: "system", subtype: "init", session_id: "s1" },
              { type: "result", is_error: true, errors: ["overloaded_error"] },
            ])
          : scriptedHandle([
              // retry resumes s1 → same id, swallowed
              { type: "system", subtype: "init", session_id: "s1" },
              { type: "result", is_error: false, result: "ok", total_cost_usd: 0, num_turns: 1, session_id: "s1" },
            ]);
      },
    });
    const session = await backend.openSession(CTX);
    const events = await collect(session.send("go"));

    expect(call).toBe(2);
    expect(events.filter((e) => e.type === "session")).toHaveLength(1);
    const last = events.at(-1)!;
    expect(last.type).toBe("result");
    if (last.type === "result") expect(last.text).toBe("ok");
    await session.close();
  });

  test("a retryable error that survives all retries becomes providerDown (→ failover)", async () => {
    let call = 0;
    const backend = new ClaudeBackend({
      queryFn: () => {
        call++;
        return scriptedHandle([{ type: "result", is_error: true, errors: ["overloaded_error"] }]);
      },
    });
    const session = await backend.openSession(CTX);
    const events = await collect(session.send("go"));

    expect(call).toBe(3); // initial + 2 retries
    const last = events.at(-1)!;
    expect(last.type).toBe("error");
    if (last.type === "error") {
      expect(last.retryable).toBe(true);
      expect(last.providerDown).toBe(true); // exhausted retries → fail over
    }
    await session.close();
  });

  test("interactive sessions load settingSources/partials; jobs do not", async () => {
    const captured: Record<string, unknown>[] = [];
    const capturingBackend = (interactive: boolean) =>
      new ClaudeBackend({
        queryFn: (args) => {
          captured.push(args.options as Record<string, unknown>);
          return scriptedHandle([
            { type: "system", subtype: "init", session_id: "s1" },
            { type: "result", is_error: false, result: "ok", total_cost_usd: 0, num_turns: 1, session_id: "s1" },
          ]);
        },
      }).openSession({ ...CTX, interactive });

    const chat = await capturingBackend(true);
    await collect(chat.send("x"));
    const jobBackend = await capturingBackend(false);
    await collect(jobBackend.send("x"));

    const chatOpts = captured[0]!;
    const jobOpts = captured[1]!;
    expect(chatOpts.settingSources).toEqual(["project", "user"]);
    expect(chatOpts.includePartialMessages).toBe(true);
    expect(chatOpts.continue).toBe(false);
    expect(jobOpts.settingSources).toBeUndefined();
    expect(jobOpts.includePartialMessages).toBeUndefined();
    expect(jobOpts.continue).toBeUndefined();
  });

  test("abort() interrupts an in-flight send by throwing the reason", async () => {
    // A handle whose next() rejects when close() is called.
    function abortableHandle(): QueryHandle {
      let rejectNext: ((e: unknown) => void) | null = null;
      const iter: AsyncIterator<unknown> = {
        next() {
          return new Promise<IteratorResult<unknown>>((_resolve, reject) => {
            rejectNext = reject;
          });
        },
      };
      return Object.assign(
        { [Symbol.asyncIterator]: () => iter },
        {
          close() {
            rejectNext?.(new Error("closed"));
          },
        },
      );
    }
    const backend = new ClaudeBackend({ queryFn: () => abortableHandle() });
    const session = await backend.openSession(CTX);
    const iterating = collect(session.send("hang"));
    await new Promise((r) => setTimeout(r, 5)); // let it reach next()
    session.abort("shutdown");
    await expect(iterating).rejects.toThrow("shutdown");
  });
});
