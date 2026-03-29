import type postgres from "postgres";

export const name = "011_session_metadata";

export async function up(sql: postgres.Sql): Promise<void> {
  await sql`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS metadata JSONB`;
}
