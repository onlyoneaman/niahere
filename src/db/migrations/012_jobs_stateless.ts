import type postgres from "postgres";

export const name = "012_jobs_stateless";

export async function up(sql: postgres.Sql): Promise<void> {
  await sql`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS stateless BOOLEAN DEFAULT FALSE`;
}
