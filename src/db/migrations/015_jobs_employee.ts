import type postgres from "postgres";

export const name = "015_jobs_employee";

export async function up(sql: postgres.Sql): Promise<void> {
  await sql`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS employee TEXT`;
}
