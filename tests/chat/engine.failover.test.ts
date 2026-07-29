/**
 * Chat failover: when the primary backend is provider-down, the engine answers
 * the current message on the next backend. Fake chain + real test DB.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { setupTestDb, teardownTestDb } from "../db/setup";
import { setBackendChain } from "../../src/agent";
import type { AgentBackend, AgentEvent, AgentSessionContext, ChainEntry } from "../../src/agent";
import { Session, Message } from "../../src/db/models";
import { providerHealth } from "../../src/agent/health";

const PREFIX = `test-chat-fo-${process.pid}`;

/** `seen` captures the session context each entry is opened with. */
function entry(name: AgentBackend["name"], events: AgentEvent[], seen?: AgentSessionContext[]): ChainEntry {
  const backend: AgentBackend = {
    name,
    async openSession(ctx) {
      seen?.push(ctx);
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
  return { backend };
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
afterEach(() => {
  setBackendChain(null);
  providerHealth.clear();
});

describe("chat failover", () => {
  test("a provider-down primary fails over to the fallback, which answers", async () => {
    const sid = `${PREFIX}-1`;
    setBackendChain([
      entry("claude", [{ type: "error", message: "", retryable: false, failover: "provider" }]),
      entry("codex", [
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

  test("failover re-saves the user turn when the primary established a session before going down", async () => {
    const sid1 = `${PREFIX}-down-1`;
    const sid2 = `${PREFIX}-up-2`;
    setBackendChain([
      // Primary opens a session, then goes provider-down mid-turn — this sets
      // userSaved=true under sid1 before failover.
      entry("claude", [
        { type: "session", backendSessionId: sid1 },
        { type: "error", message: "", retryable: false, failover: "provider" },
      ]),
      entry("codex", [
        { type: "session", backendSessionId: sid2 },
        {
          type: "result",
          text: "answered by codex",
          usage: { tokens: { input: 1, output: 1 } },
          backendSessionId: sid2,
        },
      ]),
    ]);

    const { createChatEngine } = await import("../../src/chat/engine");
    const engine = await createChatEngine({ room: `${PREFIX}-down-room`, channel: "test", resume: false });
    await engine.send("my question");

    // The failed-over session must carry the user's question, not just the reply.
    const { getSql } = await import("../../src/db/connection");
    const rows = await getSql()`SELECT sender, content FROM messages WHERE session_id = ${sid2} ORDER BY id`;
    expect(rows.map((r: any) => r.sender)).toEqual(["user", "nia"]);
    expect(rows[0].content).toBe("my question");
  });
});

describe("chat failover continuity", () => {
  test("hands the fallback the conversation so far", async () => {
    const room = `${PREFIX}-history-room`;
    const priorSession = `${PREFIX}-history-prior`;
    await Session.create(priorSession, room);
    await Message.save({ sessionId: priorSession, room, sender: "user", content: "my cat is called Biscuit", isFromAgent: false });
    await Message.save({ sessionId: priorSession, room, sender: "nia", content: "noted, Biscuit it is", isFromAgent: true });

    const seen: AgentSessionContext[] = [];
    const sid = `${PREFIX}-history-2`;
    setBackendChain([
      entry("claude", [{ type: "error", message: "", retryable: false, failover: "provider" }], seen),
      entry(
        "codex",
        [
          { type: "session", backendSessionId: sid },
          { type: "result", text: "Biscuit", usage: {}, backendSessionId: sid },
        ],
        seen,
      ),
    ]);

    const { createChatEngine } = await import("../../src/chat/engine");
    const engine = await createChatEngine({ room, channel: "test", resume: false });
    await engine.send("what is my cat called?");

    const fallbackPrompt = seen.at(-1)!.systemPrompt;
    expect(fallbackPrompt).toContain("Biscuit");
    expect(fallbackPrompt).toContain("noted, Biscuit it is");
    // The primary saw no handoff — it had the live session.
    expect(seen[0]!.systemPrompt).not.toContain("noted, Biscuit it is");
  });

  test("a fallback that cannot start advances instead of killing the turn", async () => {
    const room = `${PREFIX}-throw-room`;
    const sid = `${PREFIX}-throw-1`;
    const broken: AgentBackend = {
      name: "codex",
      async openSession() {
        throw new Error("spawn codex ENOENT");
      },
      async canResume() {
        return false;
      },
    };
    setBackendChain([
      { backend: broken },
      entry("claude", [
        { type: "session", backendSessionId: sid },
        { type: "result", text: "recovered", usage: {}, backendSessionId: sid },
      ]),
    ]);

    const { createChatEngine } = await import("../../src/chat/engine");
    const engine = await createChatEngine({ room, channel: "test", resume: false });
    const res = await engine.send("hello");
    expect(res.result).toBe("recovered");
  });
});
