/**
 * Unified session finalizer — durable queue for post-session work.
 *
 * All callers use finalizeSession() instead of calling consolidator/summarizer
 * directly. The function writes a row to finalization_requests and returns
 * immediately. In daemon mode, it also starts processing inline. In CLI mode,
 * it fires pg_notify('nia_finalize') to wake the daemon.
 *
 * The daemon listens on nia_finalize and also drains pending requests on startup.
 */

import { getSql } from "../db/connection";
import { consolidateSession } from "./consolidator";
import { summarizeSession } from "./summarizer";
import { log } from "../utils/log";

type ProcessRole = "daemon" | "cli";
let role: ProcessRole = "cli";

export function setRole(r: ProcessRole): void {
  role = r;
}

export function getRole(): ProcessRole {
  return role;
}

/** Enqueue a session for finalization. Returns immediately for CLI callers. */
export async function finalizeSession(sessionId: string, room: string): Promise<void> {
  const sql = getSql();

  // Get current message count for idempotency
  const countRows = await sql`
    SELECT COUNT(*)::int AS count FROM messages WHERE session_id = ${sessionId}
  `;
  const messageCount = countRows[0]?.count ?? 0;
  if (messageCount < 2) return;

  // Cancel any pending request for this session (session resumed or new close)
  await sql`
    DELETE FROM finalization_requests
    WHERE session_id = ${sessionId} AND status = 'pending'
  `;

  // Skip if already done/processing for this exact message count
  const existing = await sql`
    SELECT id FROM finalization_requests
    WHERE session_id = ${sessionId}
      AND message_count = ${messageCount}
      AND status IN ('done', 'processing')
    LIMIT 1
  `;
  if (existing.length > 0) return;

  // Insert new request
  await sql`
    INSERT INTO finalization_requests (session_id, room, message_count, status)
    VALUES (${sessionId}, ${room}, ${messageCount}, 'pending')
  `;

  if (role === "daemon") {
    // Process inline (fire-and-forget) — we're long-lived
    processOne(sessionId, room, messageCount).catch((err) => {
      log.error({ err, sessionId, room }, "finalizer: inline processing failed");
    });
  } else {
    // Wake the daemon via NOTIFY
    await sql.notify("nia_finalize", sessionId).catch((err) => {
      log.warn({ err, sessionId }, "finalizer: pg_notify failed (daemon may not be running)");
    });
  }
}

/** Cancel pending finalization for a session (e.g. session resumed). */
export async function cancelPending(sessionId: string): Promise<void> {
  const sql = getSql();
  await sql`
    DELETE FROM finalization_requests
    WHERE session_id = ${sessionId} AND status = 'pending'
  `;
}

/** Process a single finalization request. */
async function processOne(sessionId: string, room: string, messageCount: number): Promise<void> {
  const sql = getSql();

  // Claim the request (pending -> processing)
  const claimed = await sql`
    UPDATE finalization_requests
    SET status = 'processing', updated_at = NOW()
    WHERE session_id = ${sessionId}
      AND message_count = ${messageCount}
      AND status = 'pending'
    RETURNING id
  `;
  if (claimed.length === 0) return; // Already claimed or cancelled

  const requestId = claimed[0].id;

  try {
    await Promise.allSettled([consolidateSession(sessionId, room), summarizeSession(sessionId, room)]);

    await sql`
      UPDATE finalization_requests
      SET status = 'done', updated_at = NOW()
      WHERE id = ${requestId}
    `;

    log.info({ sessionId, room, messageCount }, "finalizer: completed");
  } catch (err) {
    await sql`
      UPDATE finalization_requests
      SET status = 'failed', updated_at = NOW()
      WHERE id = ${requestId}
    `.catch(() => {});

    log.error({ err, sessionId, room }, "finalizer: processing failed");
  }
}

/** Drain all pending finalization requests. Called by daemon on startup and on NOTIFY. */
export async function processPending(): Promise<void> {
  const sql = getSql();

  const pending = await sql`
    SELECT session_id, room, message_count
    FROM finalization_requests
    WHERE status = 'pending'
    ORDER BY created_at ASC
  `;

  for (const row of pending) {
    await processOne(row.session_id, row.room, row.message_count);
  }
}

/** Clean up old completed/failed requests (> 7 days). Called periodically by daemon. */
export async function cleanupOldRequests(): Promise<void> {
  const sql = getSql();
  await sql`
    DELETE FROM finalization_requests
    WHERE status IN ('done', 'failed')
      AND updated_at < NOW() - INTERVAL '7 days'
  `;
}
