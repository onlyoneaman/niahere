import type postgres from "postgres";

export const name = "007_jobs_agent";

export async function up(sql: postgres.Sql): Promise<void> {
  await sql`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS agent TEXT`;
}
