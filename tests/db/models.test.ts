import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { sql } from "../../src/db/connection";
import { runMigrations } from "../../src/db/migrate";
import * as Session from "../../src/db/models/session";
import * as Message from "../../src/db/models/message";
import * as ActiveEngine from "../../src/db/models/active_engine";
import * as Job from "../../src/db/models/job";

const TEST_ROOM = `test-room-${Date.now()}`;

beforeAll(async () => {
  await runMigrations();
});

afterAll(async () => {
  await sql`DELETE FROM messages WHERE room = ${TEST_ROOM}`;
  await sql`DELETE FROM sessions WHERE room = ${TEST_ROOM}`;
  await sql.end();
});

describe("Session model", () => {
  test("getLatest returns null when no sessions exist", async () => {
    const result = await Session.getLatest(TEST_ROOM);
    expect(result).toBeNull();
  });

  test("create and getLatest", async () => {
    const id = `test-session-${Date.now()}`;
    await Session.create(id, TEST_ROOM);

    const result = await Session.getLatest(TEST_ROOM);
    expect(result).toBe(id);
  });

  test("getLatest returns most recent session", async () => {
    const id1 = `test-old-${Date.now()}`;
    const id2 = `test-new-${Date.now() + 1}`;

    await Session.create(id1, TEST_ROOM);
    await new Promise((r) => setTimeout(r, 10));
    await Session.create(id2, TEST_ROOM);

    const result = await Session.getLatest(TEST_ROOM);
    expect(result).toBe(id2);
  });

  test("touch updates updated_at", async () => {
    const id = `test-touch-${Date.now()}`;
    await Session.create(id, TEST_ROOM);

    const [before] = await sql`SELECT updated_at FROM sessions WHERE id = ${id}`;
    await new Promise((r) => setTimeout(r, 10));
    await Session.touch(id);
    const [after] = await sql`SELECT updated_at FROM sessions WHERE id = ${id}`;

    expect(new Date(after.updated_at).getTime()).toBeGreaterThan(new Date(before.updated_at).getTime());
  });
});

describe("Message model", () => {
  test("save stores a user message", async () => {
    const sessionId = `test-msg-${Date.now()}`;
    await Session.create(sessionId, TEST_ROOM);

    await Message.save({
      sessionId,
      room: TEST_ROOM,
      sender: "user",
      content: "hello nia",
      isFromAgent: false,
    });

    const rows = await sql`
      SELECT sender, content, is_from_agent
      FROM messages WHERE session_id = ${sessionId}
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0].sender).toBe("user");
    expect(rows[0].content).toBe("hello nia");
    expect(rows[0].is_from_agent).toBe(false);
  });

  test("save stores an agent message", async () => {
    const sessionId = `test-agent-${Date.now()}`;
    await Session.create(sessionId, TEST_ROOM);

    await Message.save({
      sessionId,
      room: TEST_ROOM,
      sender: "nia",
      content: "hi there!",
      isFromAgent: true,
    });

    const rows = await sql`
      SELECT sender, is_from_agent
      FROM messages WHERE session_id = ${sessionId}
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0].sender).toBe("nia");
    expect(rows[0].is_from_agent).toBe(true);
  });

  test("messages are ordered by created_at", async () => {
    const sessionId = `test-order-${Date.now()}`;
    await Session.create(sessionId, TEST_ROOM);

    await Message.save({ sessionId, room: TEST_ROOM, sender: "user", content: "first", isFromAgent: false });
    await Message.save({ sessionId, room: TEST_ROOM, sender: "nia", content: "second", isFromAgent: true });
    await Message.save({ sessionId, room: TEST_ROOM, sender: "user", content: "third", isFromAgent: false });

    const rows = await sql`
      SELECT content FROM messages
      WHERE session_id = ${sessionId}
      ORDER BY created_at ASC
    `;
    expect(rows).toHaveLength(3);
    expect(rows[0].content).toBe("first");
    expect(rows[1].content).toBe("second");
    expect(rows[2].content).toBe("third");
  });

  test("getRoomStats returns stats per room", async () => {
    const stats = await Message.getRoomStats();
    // Should include our test room if we have messages
    expect(Array.isArray(stats)).toBe(true);
    for (const s of stats) {
      expect(s).toHaveProperty("room");
      expect(s).toHaveProperty("sessions");
      expect(s).toHaveProperty("messages");
      expect(s).toHaveProperty("lastActivity");
    }
  });
});

describe("ActiveEngine model", () => {
  const TEST_ENGINE_ROOM = `test-engine-${Date.now()}`;

  test("register and list", async () => {
    await ActiveEngine.register(TEST_ENGINE_ROOM, "test");
    const engines = await ActiveEngine.list();
    const found = engines.find((e) => e.room === TEST_ENGINE_ROOM);
    expect(found).toBeDefined();
    expect(found!.channel).toBe("test");
  });

  test("unregister removes engine", async () => {
    await ActiveEngine.unregister(TEST_ENGINE_ROOM);
    const engines = await ActiveEngine.list();
    const found = engines.find((e) => e.room === TEST_ENGINE_ROOM);
    expect(found).toBeUndefined();
  });

  test("clearAll removes all engines", async () => {
    await ActiveEngine.register(`${TEST_ENGINE_ROOM}-1`, "test");
    await ActiveEngine.register(`${TEST_ENGINE_ROOM}-2`, "test");
    await ActiveEngine.clearAll();
    const engines = await ActiveEngine.list();
    const found = engines.filter((e) => e.room.startsWith(TEST_ENGINE_ROOM));
    expect(found).toHaveLength(0);
  });
});

describe("Job model", () => {
  const TEST_JOB = `test-job-${Date.now()}`;

  afterAll(async () => {
    await sql`DELETE FROM jobs WHERE name LIKE ${TEST_JOB + "%"}`;
  });

  test("create and get", async () => {
    await Job.create(TEST_JOB, "*/5 * * * *", "do something");
    const job = await Job.get(TEST_JOB);
    expect(job).not.toBeNull();
    expect(job!.name).toBe(TEST_JOB);
    expect(job!.schedule).toBe("*/5 * * * *");
    expect(job!.prompt).toBe("do something");
    expect(job!.enabled).toBe(true);
  });

  test("list includes created job", async () => {
    const jobs = await Job.list();
    const found = jobs.find((j) => j.name === TEST_JOB);
    expect(found).toBeDefined();
  });

  test("update changes fields", async () => {
    const updated = await Job.update(TEST_JOB, { enabled: false, prompt: "updated prompt" });
    expect(updated).toBe(true);

    const job = await Job.get(TEST_JOB);
    expect(job!.enabled).toBe(false);
    expect(job!.prompt).toBe("updated prompt");
  });

  test("listEnabled excludes disabled jobs", async () => {
    const enabled = await Job.listEnabled();
    const found = enabled.find((j) => j.name === TEST_JOB);
    expect(found).toBeUndefined();
  });

  test("remove deletes job", async () => {
    const removed = await Job.remove(TEST_JOB);
    expect(removed).toBe(true);

    const job = await Job.get(TEST_JOB);
    expect(job).toBeNull();
  });

  test("update returns false for nonexistent job", async () => {
    const updated = await Job.update("nonexistent-job", { enabled: true });
    expect(updated).toBe(false);
  });
});
