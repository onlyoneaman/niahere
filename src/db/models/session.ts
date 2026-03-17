import { getSql } from "../connection";

export interface SessionSummary {
  id: string;
  room: string;
  createdAt: string;
  updatedAt: string;
  preview: string | null;
  messageCount: number;
}

export async function getLatest(room: string): Promise<string | null> {
  const sql = getSql();
  const rows = await sql`
    SELECT id FROM sessions
    WHERE room = ${room}
    ORDER BY updated_at DESC
    LIMIT 1
  `;
  return rows.length > 0 ? rows[0].id : null;
}

export async function getRecent(room: string, limit = 10): Promise<SessionSummary[]> {
  const sql = getSql();
  const rows = await sql`
    SELECT
      s.id,
      s.room,
      s.created_at,
      s.updated_at,
      (
        SELECT content FROM messages m
        WHERE m.session_id = s.id AND m.sender = 'user'
        ORDER BY m.created_at ASC LIMIT 1
      ) AS preview,
      (SELECT COUNT(*)::int FROM messages m WHERE m.session_id = s.id) AS message_count
    FROM sessions s
    WHERE s.room = ${room}
    ORDER BY s.updated_at DESC
    LIMIT ${limit}
  `;
  return rows.map((r) => ({
    id: r.id,
    room: r.room,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
    preview: r.preview ? String(r.preview) : null,
    messageCount: r.message_count,
  }));
}

export async function create(id: string, room: string): Promise<void> {
  const sql = getSql();
  await sql`INSERT INTO sessions (id, room) VALUES (${id}, ${room})`;
}

export async function touch(id: string): Promise<void> {
  const sql = getSql();
  await sql`UPDATE sessions SET updated_at = NOW() WHERE id = ${id}`;
}

export async function getLatestRoomIndex(prefix: string): Promise<number> {
  const sql = getSql();
  const rows = await sql`
    SELECT room FROM sessions
    WHERE room LIKE ${prefix + "-%"}
    ORDER BY updated_at DESC
    LIMIT 1
  `;
  if (rows.length === 0) return 0;
  const parts = rows[0].room.split("-");
  const idx = parseInt(parts[parts.length - 1], 10);
  return isNaN(idx) ? 0 : idx;
}
