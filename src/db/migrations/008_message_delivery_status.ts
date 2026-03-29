import type postgres from "postgres";

export const name = "008_message_delivery_status";

export async function up(sql: postgres.Sql): Promise<void> {
  await sql`
    ALTER TABLE messages
    ADD COLUMN IF NOT EXISTS delivery_status TEXT DEFAULT 'sent'
  `;
}
