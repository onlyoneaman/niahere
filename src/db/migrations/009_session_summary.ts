import type postgres from "postgres";

export const name = "009_session_summary";

export async function up(sql: postgres.Sql): Promise<void> {
  await sql`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS summary TEXT`;
}
