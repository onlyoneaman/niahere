import { readdirSync } from "fs";
import { join, basename } from "path";
import { sql } from "./connection";

interface Migration {
  name: string;
  up: (sql: typeof import("./connection").sql) => Promise<void>;
}

const migrationsDir = join(import.meta.dir, "migrations");

async function loadMigrations(): Promise<Migration[]> {
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".ts") || f.endsWith(".js"))
    .sort();

  const migrations: Migration[] = [];
  for (const file of files) {
    const mod = await import(join(migrationsDir, file));
    migrations.push({
      name: mod.name || basename(file, ".ts"),
      up: mod.up,
    });
  }
  return migrations;
}

export async function runMigrations(): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS _migrations (
      id         SERIAL PRIMARY KEY,
      name       TEXT UNIQUE NOT NULL,
      applied_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  const applied = await sql`SELECT name FROM _migrations`;
  const appliedNames = new Set(applied.map((r) => r.name));

  const migrations = await loadMigrations();

  for (const m of migrations) {
    if (!appliedNames.has(m.name)) {
      await m.up(sql);
      await sql`INSERT INTO _migrations (name) VALUES (${m.name})`;
    }
  }
}
