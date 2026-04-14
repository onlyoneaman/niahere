import type postgres from "postgres";

export const name = "016_jobs_status";

export async function up(sql: postgres.Sql): Promise<void> {
  // Add status column: active | disabled | archived
  await sql`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'`;
  // Backfill from enabled boolean
  await sql`UPDATE jobs SET status = CASE WHEN enabled THEN 'active' ELSE 'disabled' END WHERE status = 'active'`;
}
