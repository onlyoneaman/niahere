/**
 * Engine save-once characterization (the Task 1.0 guarantee, pinned at the seam).
 * Uses a fake AgentBackend (no Claude) against the real test DB to assert the
 * engine persists exactly one user message + one assistant message per turn,
 * driven by a single `session` event.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { setupTestDb, teardownTestDb } from "../db/setup";
import { setBackend } from "../../src/agent";
import type { AgentBackend, AgentEvent, AgentSession } from "../../src/agent";

const PREFIX = `test-engine-save-${process.pid}`;

class FakeSession implements AgentSession {
  backendSessionId: string | null = null;
  constructor(private events: AgentEvent[]) {}
  async *send(): AsyncIterable<AgentEvent> {
    for (const ev of this.events) {
      if (ev.type === "session") this.backendSessionId = ev.backendSessionId;
      yield ev;
    }
  }
  abort(): void {}
  async close(): Promise<void> {}
}

function fakeBackend(events: AgentEvent[]): AgentBackend {
  return {
    name: "claude",
    async openSession() {
      return new FakeSession(events);
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

afterEach(() => setBackend(null));

describe("engine save-once", () => {
  test("a new-session turn saves exactly one user + one assistant message", async () => {
    const sid = `${PREFIX}-1`;
    setBackend(
      fakeBackend([
        { type: "session", backendSessionId: sid },
        { type: "text", delta: "hi" },
        { type: "result", text: "hi", usage: { costUsd: 0.01, turns: 1 }, backendSessionId: sid },
      ]),
    );

    const { createChatEngine } = await import("../../src/chat/engine");
    const engine = await createChatEngine({ room: `${PREFIX}-room`, channel: "test", resume: false });
    const res = await engine.send("hello");
    expect(res.result).toBe("hi");

    const { getSql } = await import("../../src/db/connection");
    const sql = getSql();
    const rows = await sql`SELECT sender, content FROM messages WHERE session_id = ${sid} ORDER BY id`;
    expect(rows.map((r: any) => r.sender)).toEqual(["user", "nia"]);
    expect(rows.map((r: any) => r.content)).toEqual(["hello", "hi"]);
  });
});
