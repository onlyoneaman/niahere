import postgres from "postgres";
import { getConfig } from "../utils/config";

let _sql: ReturnType<typeof postgres> | null = null;

export function getSql(): ReturnType<typeof postgres> {
  if (!_sql) {
    _sql = postgres(getConfig().database_url, { onnotice: () => {} });
  }
  return _sql;
}

export async function closeDb(): Promise<void> {
  if (_sql) {
    await _sql.end();
    _sql = null;
  }
}

/** Run migrations, execute fn, then close DB. */
export async function withDb<T>(fn: () => Promise<T>): Promise<T> {
  const { runMigrations } = await import("./migrate");
  await runMigrations();
  try {
    return await fn();
  } finally {
    await closeDb();
  }
}
