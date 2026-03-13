import type postgres from "postgres";

export const name = "006_jobs_scheduling";

export async function up(sql: postgres.Sql): Promise<void> {
  await sql`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS schedule_type TEXT DEFAULT 'cron'`;
  await sql`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS next_run_at TIMESTAMPTZ`;
  await sql`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS last_run_at TIMESTAMPTZ`;
}
