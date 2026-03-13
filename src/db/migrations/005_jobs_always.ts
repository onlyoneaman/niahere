import type postgres from "postgres";

export const name = "005_jobs_always";

export async function up(sql: postgres.Sql): Promise<void> {
  await sql`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS always BOOLEAN DEFAULT FALSE`;
}
