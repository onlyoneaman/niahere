import { describe, expect, test, beforeAll } from "bun:test";
import { getSql } from "../../src/db/connection";
import { runMigrations } from "../../src/db/migrate";

beforeAll(async () => {
  await runMigrations();
});

describe("runMigrations", () => {
  test("creates _migrations table", async () => {
    const sql = getSql();
    const tables = await sql`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = '_migrations'
    `;
    expect(tables).toHaveLength(1);
  });

  test("records applied migrations", async () => {
    const sql = getSql();
    const rows = await sql`SELECT name FROM _migrations ORDER BY id`;
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows[0].name).toBe("001_sessions");
    expect(rows[1].name).toBe("002_messages");
  });

  test("is idempotent — running again does not fail", async () => {
    await runMigrations();
    const sql = getSql();
    const rows = await sql`SELECT name FROM _migrations ORDER BY id`;
    // Should still have same migrations, no duplicates
    const names = rows.map((r: any) => r.name);
    expect(new Set(names).size).toBe(names.length);
  });

  test("creates sessions and messages tables", async () => {
    const sql = getSql();
    const tables = await sql`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name IN ('sessions', 'messages')
      ORDER BY table_name
    `;
    expect(tables).toHaveLength(2);
    expect(tables[0].table_name).toBe("messages");
    expect(tables[1].table_name).toBe("sessions");
  });
});
