import type postgres from "postgres";

export const name = "018_resolve_local_pending";

/**
 * Replies from `nia run`, the REPL and jobs were written as pending and never
 * confirmed, because those paths print to stdout and have no delivery to
 * confirm. They are not undelivered; they were delivered to a terminal.
 *
 * Resolving them is what makes the genuinely stuck rows visible — they were
 * hidden among 23 artifacts going back to March.
 */
export async function up(sql: postgres.Sql): Promise<void> {
  await sql`
    UPDATE messages SET delivery_status = 'sent'
    WHERE is_from_agent
      AND delivery_status = 'pending'
      AND (room = 'terminal' OR room LIKE 'cli-run%' OR room LIKE '_system/%' OR room LIKE 'debug-%' OR room LIKE '%-debug-%')
  `;
}
