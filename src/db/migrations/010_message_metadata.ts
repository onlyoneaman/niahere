import type postgres from "postgres";

export const name = "010_message_metadata";

export async function up(sql: postgres.Sql): Promise<void> {
  await sql`
    ALTER TABLE messages
    ADD COLUMN IF NOT EXISTS metadata JSONB
  `;
}
