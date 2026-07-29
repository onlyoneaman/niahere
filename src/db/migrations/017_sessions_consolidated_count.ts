import type postgres from "postgres";

export const name = "017_sessions_consolidated_count";

/** Watermark for the memory consolidator. Lives in the DB rather than in
 *  memory so a daemon restart does not re-consolidate every session again. */
export async function up(sql: postgres.Sql): Promise<void> {
  await sql`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS consolidated_count INTEGER NOT NULL DEFAULT 0`;
}
