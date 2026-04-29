import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { getSql } from "../../src/db/connection";
import * as Session from "../../src/db/models/session";
import * as Message from "../../src/db/models/message";
import * as ActiveEngine from "../../src/db/models/active_engine";
import * as Job from "../../src/db/models/job";
import { setupTestDb, teardownTestDb } from "./setup";

const TEST_ROOM = `test-room-${Date.now()}`;

beforeAll(async () => {
  await setupTestDb();
});

afterAll(async () => {
  const sql = getSql();
  await sql`DELETE FROM messages WHERE room = ${TEST_ROOM}`;
  await sql`DELETE FROM sessions WHERE room = ${TEST_ROOM}`;
  await teardownTestDb();
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
    const sql = getSql();
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
    const sql = getSql();
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
    const sql = getSql();
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
    const sql = getSql();
    const sessionId = `test-order-${Date.now()}`;
    await Session.create(sessionId, TEST_ROOM);

    await Message.save({
      sessionId,
      room: TEST_ROOM,
      sender: "user",
      content: "first",
      isFromAgent: false,
    });
    await Message.save({
      sessionId,
      room: TEST_ROOM,
      sender: "nia",
      content: "second",
      isFromAgent: true,
    });
    await Message.save({
      sessionId,
      room: TEST_ROOM,
      sender: "user",
      content: "third",
      isFromAgent: false,
    });

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

describe("Session.listRecent", () => {
  test("returns sessions across all rooms", async () => {
    const sessions = await Session.listRecent(5);
    expect(Array.isArray(sessions)).toBe(true);
    for (const s of sessions) {
      expect(s).toHaveProperty("id");
      expect(s).toHaveProperty("room");
      expect(s).toHaveProperty("preview");
      expect(s).toHaveProperty("messageCount");
    }
  });

  test("filters by room when provided", async () => {
    const sessions = await Session.listRecent(5, TEST_ROOM);
    for (const s of sessions) {
      expect(s.room).toBe(TEST_ROOM);
    }
  });
});

describe("Message.search", () => {
  test("finds messages by keyword", async () => {
    const results = await Message.search("hello nia");
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0]).toHaveProperty("sessionId");
    expect(results[0]).toHaveProperty("room");
    expect(results[0]).toHaveProperty("content");
    expect(results[0].content.toLowerCase()).toContain("hello nia");
  });

  test("returns empty for non-matching query", async () => {
    const results = await Message.search(`xyznonexistent${Date.now()}`);
    expect(results).toHaveLength(0);
  });

  test("filters by room", async () => {
    const results = await Message.search("hello", 20, TEST_ROOM);
    for (const r of results) {
      expect(r.room).toBe(TEST_ROOM);
    }
  });
});

describe("Message.getBySession", () => {
  test("returns messages for a session in chronological order", async () => {
    const sessionId = `test-bysession-${Date.now()}`;
    await Session.create(sessionId, TEST_ROOM);
    await Message.save({
      sessionId,
      room: TEST_ROOM,
      sender: "user",
      content: "msg1",
      isFromAgent: false,
    });
    await Message.save({
      sessionId,
      room: TEST_ROOM,
      sender: "nia",
      content: "msg2",
      isFromAgent: true,
    });

    const messages = await Message.getBySession(sessionId);
    expect(messages).toHaveLength(2);
    expect(messages[0].content).toBe("msg1");
    expect(messages[0].isFromAgent).toBe(false);
    expect(messages[1].content).toBe("msg2");
    expect(messages[1].isFromAgent).toBe(true);
  });

  test("returns empty for nonexistent session", async () => {
    const messages = await Message.getBySession("nonexistent-session-id");
    expect(messages).toHaveLength(0);
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
    const sql = getSql();
    await sql`DELETE FROM jobs WHERE name LIKE ${TEST_JOB + "%"}`;
    await sql`DELETE FROM jobs WHERE name = '../escape'`;
  });

  test("create and get", async () => {
    await Job.create(TEST_JOB, "*/5 * * * *", "do something");
    const job = await Job.get(TEST_JOB);
    expect(job).not.toBeNull();
    expect(job!.name).toBe(TEST_JOB);
    expect(job!.schedule).toBe("*/5 * * * *");
    expect(job!.prompt).toBe("do something");
    expect(job!.status).toBe("active");
  });

  test("create rejects job names outside the jobs workspace", async () => {
    await expect(Job.create("../escape", "*/5 * * * *", "do something")).rejects.toThrow("Invalid job name");
  });

  test("create with agent and get", async () => {
    const name = TEST_JOB + "-agent";
    await Job.create(name, "*/5 * * * *", "do something", false, "cron", undefined, "marketer");
    const job = await Job.get(name);
    expect(job).not.toBeNull();
    expect(job!.agent).toBe("marketer");
  });

  test("create without agent defaults to null", async () => {
    const job = await Job.get(TEST_JOB);
    expect(job!.agent).toBeNull();
  });

  test("create with stateless flag", async () => {
    const name = TEST_JOB + "-stateless";
    await Job.create(name, "*/5 * * * *", "fire and forget", false, "cron", undefined, undefined, true);
    const job = await Job.get(name);
    expect(job).not.toBeNull();
    expect(job!.stateless).toBe(true);
  });

  test("stateless defaults to false", async () => {
    const job = await Job.get(TEST_JOB);
    expect(job!.stateless).toBe(false);
  });

  test("update stateless flag", async () => {
    const name = TEST_JOB + "-stateless-update";
    await Job.create(name, "*/5 * * * *", "test");
    expect((await Job.get(name))!.stateless).toBe(false);

    await Job.update(name, { stateless: true });
    expect((await Job.get(name))!.stateless).toBe(true);

    await Job.update(name, { stateless: false });
    expect((await Job.get(name))!.stateless).toBe(false);
  });

  test("list includes created job", async () => {
    const jobs = await Job.list();
    const found = jobs.find((j) => j.name === TEST_JOB);
    expect(found).toBeDefined();
  });

  test("update changes fields", async () => {
    const updated = await Job.update(TEST_JOB, {
      status: "disabled",
      prompt: "updated prompt",
    });
    expect(updated).toBe(true);

    const job = await Job.get(TEST_JOB);
    expect(job!.status).toBe("disabled");
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
    const updated = await Job.update("nonexistent-job", { status: "active" });
    expect(updated).toBe(false);
  });
});

describe("Job status lifecycle", () => {
  const LIFECYCLE_JOB = `test-lifecycle-${Date.now()}`;

  afterAll(async () => {
    const sql = getSql();
    await sql`DELETE FROM jobs WHERE name LIKE ${LIFECYCLE_JOB + "%"}`;
  });

  test("update can set status to archived", async () => {
    const name = LIFECYCLE_JOB + "-archive";
    await Job.create(name, "*/5 * * * *", "archive me");
    const updated = await Job.update(name, { status: "archived" });
    expect(updated).toBe(true);

    const job = await Job.get(name);
    expect(job!.status).toBe("archived");
  });

  test("listEnabled excludes archived jobs", async () => {
    const name = LIFECYCLE_JOB + "-enabled";
    await Job.create(name, "*/5 * * * *", "should be excluded");
    await Job.update(name, { status: "archived" });

    const enabled = await Job.listEnabled();
    const found = enabled.find((j) => j.name === name);
    expect(found).toBeUndefined();
  });

  test("listDue excludes archived jobs", async () => {
    const sql = getSql();
    const name = LIFECYCLE_JOB + "-due";
    await Job.create(name, "*/5 * * * *", "should not be due");
    // Set next_run_at to the past so it would be due
    await sql`UPDATE jobs SET next_run_at = NOW() - INTERVAL '1 hour' WHERE name = ${name}`;
    // Verify it shows as due when active
    let due = await Job.listDue();
    let found = due.find((j) => j.name === name);
    expect(found).toBeDefined();

    // Archive it — should no longer appear in listDue
    await Job.update(name, { status: "archived" });
    due = await Job.listDue();
    found = due.find((j) => j.name === name);
    expect(found).toBeUndefined();
  });
});
