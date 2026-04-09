import type postgres from "postgres";

export const name = "014_finalization_requests";

export async function up(sql: postgres.Sql): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS finalization_requests (
      id            SERIAL PRIMARY KEY,
      session_id    TEXT NOT NULL,
      room          TEXT NOT NULL,
      message_count INT NOT NULL,
      status        TEXT NOT NULL DEFAULT 'pending',
      created_at    TIMESTAMPTZ DEFAULT NOW(),
      updated_at    TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_finalization_session
    ON finalization_requests (session_id, status)
  `;
}
