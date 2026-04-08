/**
 * Tests for active engine tracking — verifies that list() doesn't
 * mutate (delete stale entries) and that register/unregister/clearAll
 * work correctly.
 */
import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { setupTestDb, teardownTestDb } from "../db/setup";
import * as ActiveEngine from "../../src/db/models/active_engine";

const PREFIX = `test-engine-${Date.now()}`;

beforeAll(async () => {
  await setupTestDb();
});

afterAll(async () => {
  // Clean up any leftover test entries
  await ActiveEngine.clearAll();
  await teardownTestDb();
});

describe("ActiveEngine", () => {
  test("register creates an entry", async () => {
    const room = `${PREFIX}-reg`;
    await ActiveEngine.register(room, "test");
    const engines = await ActiveEngine.list();
    const found = engines.find((e) => e.room === room);
    expect(found).toBeDefined();
    expect(found!.channel).toBe("test");
    await ActiveEngine.unregister(room);
  });

  test("unregister removes the entry", async () => {
    const room = `${PREFIX}-unreg`;
    await ActiveEngine.register(room, "test");
    await ActiveEngine.unregister(room);
    const engines = await ActiveEngine.list();
    expect(engines.find((e) => e.room === room)).toBeUndefined();
  });

  test("list does NOT delete stale entries", async () => {
    const room = `${PREFIX}-stale`;
    await ActiveEngine.register(room, "test");

    // Manually backdate last_ping to simulate a long-running engine
    const { getSql } = await import("../../src/db/connection");
    const sql = getSql();
    await sql`UPDATE active_engines SET last_ping = NOW() - interval '30 minutes' WHERE room = ${room}`;

    // list() should still return the entry (not delete it)
    const engines = await ActiveEngine.list();
    const found = engines.find((e) => e.room === room);
    expect(found).toBeDefined();

    await ActiveEngine.unregister(room);
  });

  test("register is upsert — re-registering updates last_ping", async () => {
    const room = `${PREFIX}-upsert`;
    await ActiveEngine.register(room, "test");

    const { getSql } = await import("../../src/db/connection");
    const sql = getSql();
    // Backdate
    await sql`UPDATE active_engines SET last_ping = NOW() - interval '1 hour' WHERE room = ${room}`;
    const [before] =
      await sql`SELECT last_ping FROM active_engines WHERE room = ${room}`;

    // Re-register
    await ActiveEngine.register(room, "test");
    const [after] =
      await sql`SELECT last_ping FROM active_engines WHERE room = ${room}`;

    expect(new Date(after.last_ping).getTime()).toBeGreaterThan(
      new Date(before.last_ping).getTime(),
    );

    await ActiveEngine.unregister(room);
  });

  test("ping updates last_ping", async () => {
    const room = `${PREFIX}-ping`;
    await ActiveEngine.register(room, "test");

    const { getSql } = await import("../../src/db/connection");
    const sql = getSql();
    await sql`UPDATE active_engines SET last_ping = NOW() - interval '1 hour' WHERE room = ${room}`;
    const [before] =
      await sql`SELECT last_ping FROM active_engines WHERE room = ${room}`;

    await ActiveEngine.ping(room);
    const [after] =
      await sql`SELECT last_ping FROM active_engines WHERE room = ${room}`;

    expect(new Date(after.last_ping).getTime()).toBeGreaterThan(
      new Date(before.last_ping).getTime(),
    );

    await ActiveEngine.unregister(room);
  });

  test("clearAll removes all entries", async () => {
    await ActiveEngine.register(`${PREFIX}-a`, "test");
    await ActiveEngine.register(`${PREFIX}-b`, "test");
    await ActiveEngine.clearAll();
    const engines = await ActiveEngine.list();
    const found = engines.filter((e) => e.room.startsWith(PREFIX));
    expect(found).toHaveLength(0);
  });
});
