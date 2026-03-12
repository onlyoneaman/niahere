import { getSql } from "../connection";

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
