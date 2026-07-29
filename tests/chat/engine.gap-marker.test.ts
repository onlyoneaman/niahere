/**
 * The gap marker end to end: what reaches the backend and what lands in the
 * database must be the same string.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { setupTestDb, teardownTestDb } from "../db/setup";
import { setBackendChain } from "../../src/agent";
import { Session, Message } from "../../src/db/models";
import type { AgentBackend, AgentEvent, ChainEntry } from "../../src/agent";

const PREFIX = `test-gap-${process.pid}`;

/** Records the exact text handed to the backend. */
function recordingEntry(sid: string, sent: string[]): ChainEntry {
  const backend: AgentBackend = {
    name: "claude",
    async openSession() {
      return {
        backendSessionId: null as string | null,
        async *send(text: string): AsyncIterable<AgentEvent> {
          sent.push(text);
          yield { type: "session", backendSessionId: sid };
          yield { type: "result", text: "ok", usage: {}, backendSessionId: sid };
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

async function seedOldMessage(room: string, daysAgo: number): Promise<void> {
  const sid = `${PREFIX}-seed-${room}`;
  await Session.create(sid, room);
  await Message.save({ sessionId: sid, room, sender: "user", content: "older turn", isFromAgent: false });
  const { getSql } = await import("../../src/db/connection");
  await getSql()`
    UPDATE messages SET created_at = now() - (${daysAgo} || ' days')::interval
    WHERE session_id = ${sid}
  `;
}

beforeAll(async () => {
  await setupTestDb();
});
afterAll(async () => {
  const { getSql } = await import("../../src/db/connection");
  const sql = getSql();
  await sql`DELETE FROM messages WHERE room LIKE ${PREFIX + "%"}`;
  await sql`DELETE FROM sessions WHERE room LIKE ${PREFIX + "%"}`;
  await teardownTestDb();
});
afterEach(() => setBackendChain(null));

describe("gap marker through the engine", () => {
  test("a turn after a long gap is dated, and stored exactly as sent", async () => {
    const room = `${PREFIX}-stale`;
    await seedOldMessage(room, 3);

    const sent: string[] = [];
    const sid = `${PREFIX}-stale-session`;
    setBackendChain([recordingEntry(sid, sent)]);

    const { createChatEngine } = await import("../../src/chat/engine");
    const engine = await createChatEngine({ room, channel: "test", resume: false });
    await engine.send("what do you recommend?");

    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("3 days since the last message");
    expect(sent[0]).toContain("what do you recommend?");

    const { getSql } = await import("../../src/db/connection");
    const rows = await getSql()`
      SELECT content FROM messages WHERE session_id = ${sid} AND sender = 'user'
    `;
    // The record must match the transmission, not the user's raw wording.
    expect(rows[0].content).toBe(sent[0]);
  });

  test("a continuous conversation is left alone", async () => {
    const room = `${PREFIX}-fresh`;
    await seedOldMessage(room, 0);

    const sent: string[] = [];
    setBackendChain([recordingEntry(`${PREFIX}-fresh-session`, sent)]);

    const { createChatEngine } = await import("../../src/chat/engine");
    const engine = await createChatEngine({ room, channel: "test", resume: false });
    await engine.send("and the other thing?");

    expect(sent[0]).toBe("and the other thing?");
  });

  test("the first message in a brand new room is not dated", async () => {
    const sent: string[] = [];
    setBackendChain([recordingEntry(`${PREFIX}-new-session`, sent)]);

    const { createChatEngine } = await import("../../src/chat/engine");
    const engine = await createChatEngine({ room: `${PREFIX}-new`, channel: "test", resume: false });
    await engine.send("hello");

    expect(sent[0]).toBe("hello");
  });
});
