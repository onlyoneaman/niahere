import type postgres from "postgres";

export const name = "002_messages";

export async function up(sql: postgres.Sql): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS messages (
      id            SERIAL PRIMARY KEY,
      session_id    TEXT NOT NULL REFERENCES sessions(id),
      room          TEXT NOT NULL DEFAULT 'main',
      sender        TEXT NOT NULL,
      content       TEXT NOT NULL,
      is_from_agent BOOLEAN DEFAULT FALSE,
      created_at    TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  await sql`CREATE INDEX IF NOT EXISTS idx_messages_room ON messages(room, created_at)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id)`;
}
