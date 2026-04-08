/**
 * Shared test setup for DB tests.
 * Auto-creates the niahere_test database if it doesn't exist,
 * points all config at it, and runs migrations.
 */
import postgres from "postgres";
import { mkdirSync, rmSync } from "fs";
import { resetConfig } from "../../src/utils/config";
import { runMigrations } from "../../src/db/migrate";
import { closeDb } from "../../src/db/connection";

const TEST_HOME = `/tmp/nia-db-tests-${process.pid}`;
const TEST_DB_NAME = "niahere_test";
const ADMIN_URL =
  process.env.NIA_TEST_ADMIN_URL || "postgres://localhost:5432/postgres";
const TEST_DB_URL =
  process.env.NIA_TEST_DATABASE_URL ||
  `postgres://localhost:5432/${TEST_DB_NAME}`;

export async function setupTestDb(): Promise<void> {
  // Auto-create test database if it doesn't exist
  const admin = postgres(ADMIN_URL, { onnotice: () => {} });
  try {
    const rows =
      await admin`SELECT 1 FROM pg_database WHERE datname = ${TEST_DB_NAME}`;
    if (rows.length === 0) {
      await admin.unsafe(`CREATE DATABASE ${TEST_DB_NAME}`);
    }
  } catch (err: unknown) {
    // Ignore "already exists" race condition
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes("already exists")) throw err;
  } finally {
    await admin.end();
  }

  // Point config at test DB
  mkdirSync(TEST_HOME, { recursive: true });
  process.env.NIA_HOME = TEST_HOME;
  process.env.DATABASE_URL = TEST_DB_URL;
  resetConfig();

  await runMigrations();
}

export async function teardownTestDb(): Promise<void> {
  await closeDb();
  delete process.env.NIA_HOME;
  delete process.env.DATABASE_URL;
  resetConfig();
  rmSync(TEST_HOME, { recursive: true, force: true });
}
