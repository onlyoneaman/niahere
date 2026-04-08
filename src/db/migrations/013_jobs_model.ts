import type postgres from "postgres";

export const name = "013_jobs_model";

export async function up(sql: postgres.Sql): Promise<void> {
  await sql`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS model TEXT`;
}
