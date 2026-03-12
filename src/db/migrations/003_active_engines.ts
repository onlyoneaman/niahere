import type postgres from "postgres";

export const name = "003_active_engines";

export async function up(sql: postgres.Sql): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS active_engines (
      room        TEXT PRIMARY KEY,
      channel     TEXT NOT NULL,
      started_at  TIMESTAMPTZ DEFAULT NOW(),
      last_ping   TIMESTAMPTZ DEFAULT NOW()
    )
  `;
}
