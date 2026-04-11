import postgres from "postgres";
import { getConfig } from "../utils/config";
import { log } from "../utils/log";

let _sql: ReturnType<typeof postgres> | null = null;

export function getSql(): ReturnType<typeof postgres> {
  if (!_sql) {
    const url = getConfig().database_url;
    if (!url || !url.startsWith("postgres")) {
      const msg = `Invalid database_url: "${url || "(empty)"}". Expected a postgres:// connection string.`;
      log.error(msg);
      throw new Error(msg);
    }
    _sql = postgres(url, { onnotice: () => {} });
  }
  return _sql;
}

export async function closeDb(): Promise<void> {
  if (_sql) {
    await _sql.end();
    _sql = null;
  }
}
