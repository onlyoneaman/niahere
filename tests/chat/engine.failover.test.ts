/**
 * Chat failover: when the primary backend is provider-down, the engine answers
 * the current message on the next backend. Fake chain + real test DB.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { setupTestDb, teardownTestDb } from "../db/setup";
import { setBackendChain } from "../../src/agent";
import type { AgentBackend, AgentEvent } from "../../src/agent";

const PREFIX = `test-chat-fo-${process.pid}`;

function fakeBackend(name: AgentBackend["name"], events: AgentEvent[]): AgentBackend {
  return {
    name,
    async openSession() {
      return {
        backendSessionId: null as string | null,
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

beforeAll(async () => {
  await setupTestDb();
});
afterAll(async () => {
  const { getSql } = await import("../../src/db/connection");
  const sql = getSql();
  await sql`DELETE FROM messages WHERE session_id LIKE ${PREFIX + "%"}`;
  await sql`DELETE FROM sessions WHERE id LIKE ${PREFIX + "%"}`;
  await teardownTestDb();
});
afterEach(() => setBackendChain(null));

describe("chat failover", () => {
  test("a provider-down primary fails over to the fallback, which answers", async () => {
    const sid = `${PREFIX}-1`;
    setBackendChain([
      fakeBackend("claude", [{ type: "error", message: "", retryable: false, providerDown: true }]),
      fakeBackend("codex", [
        { type: "session", backendSessionId: sid },
        {
          type: "result",
          text: "answered by codex",
          usage: { tokens: { input: 1, output: 1 } },
          backendSessionId: sid,
        },
      ]),
    ]);

    const { createChatEngine } = await import("../../src/chat/engine");
    const engine = await createChatEngine({ room: `${PREFIX}-room`, channel: "test", resume: false });
    const res = await engine.send("hello");

    expect(res.result).toBe("answered by codex");
    expect(engine.sessionId).toBe(sid);

    const { getSql } = await import("../../src/db/connection");
    const rows = await getSql()`SELECT sender, content FROM messages WHERE session_id = ${sid} ORDER BY id`;
    expect(rows.map((r: any) => r.sender)).toEqual(["user", "nia"]);
  });
});
