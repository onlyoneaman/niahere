import type postgres from "postgres";

export const name = "004_jobs";

export async function up(sql: postgres.Sql): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS jobs (
      name       TEXT PRIMARY KEY,
      schedule   TEXT NOT NULL,
      prompt     TEXT NOT NULL,
      enabled    BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
}
