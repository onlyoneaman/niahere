import { getSql } from "../connection";
import type { SaveMessageParams, RoomStats, RecentMessage, SearchResult, SessionMessage } from "../../types";

export type DeliveryStatus = "pending" | "sent" | "failed";

export async function save(params: SaveMessageParams & { deliveryStatus?: DeliveryStatus; metadata?: Record<string, unknown> }): Promise<number> {
  const sql = getSql();
  const status = params.deliveryStatus || "sent";
  const meta = params.metadata ? JSON.stringify(params.metadata) : null;
  const rows = await sql`
    INSERT INTO messages (session_id, room, sender, content, is_from_agent, delivery_status, metadata)
    VALUES (${params.sessionId}, ${params.room}, ${params.sender}, ${params.content}, ${params.isFromAgent}, ${status}, ${meta})
    RETURNING id
  `;
  return rows[0].id;
}

export async function updateDeliveryStatus(id: number, status: DeliveryStatus): Promise<void> {
  const sql = getSql();
  await sql`UPDATE messages SET delivery_status = ${status} WHERE id = ${id}`;
}

export async function getUndelivered(room?: string): Promise<Array<{ id: number; room: string; content: string; createdAt: string }>> {
  const sql = getSql();
  const rows = room
    ? await sql`
        SELECT id, room, content, created_at
        FROM messages
        WHERE delivery_status = 'failed' AND is_from_agent = true AND room = ${room}
        ORDER BY created_at ASC
      `
    : await sql`
        SELECT id, room, content, created_at
        FROM messages
        WHERE delivery_status = 'failed' AND is_from_agent = true
        ORDER BY created_at ASC
      `;
  return rows.map((r) => ({
    id: r.id,
    room: r.room,
    content: r.content,
    createdAt: String(r.created_at),
  }));
}

export async function getRecent(limit = 20, room?: string): Promise<RecentMessage[]> {
  const sql = getSql();
  const rows = room
    ? await sql`
        SELECT room, sender, content, created_at
        FROM messages WHERE room = ${room}
        ORDER BY created_at DESC LIMIT ${limit}
      `
    : await sql`
        SELECT room, sender, content, created_at
        FROM messages ORDER BY created_at DESC LIMIT ${limit}
      `;
  return rows.reverse().map((r) => ({
    room: r.room,
    sender: r.sender,
    content: r.content,
    createdAt: String(r.created_at),
  }));
}

export async function search(query: string, limit = 20, room?: string): Promise<SearchResult[]> {
  const sql = getSql();
  const pattern = `%${query}%`;
  const rows = room
    ? await sql`
        SELECT session_id, room, sender, content, created_at
        FROM messages WHERE content ILIKE ${pattern} AND room = ${room}
        ORDER BY created_at DESC LIMIT ${limit}
      `
    : await sql`
        SELECT session_id, room, sender, content, created_at
        FROM messages WHERE content ILIKE ${pattern}
        ORDER BY created_at DESC LIMIT ${limit}
      `;
  return rows.map((r) => ({
    sessionId: r.session_id,
    room: r.room,
    sender: r.sender,
    content: r.content,
    createdAt: String(r.created_at),
  }));
}

export async function getBySession(sessionId: string): Promise<SessionMessage[]> {
  const sql = getSql();
  const rows = await sql`
    SELECT room, sender, content, is_from_agent, created_at
    FROM messages WHERE session_id = ${sessionId}
    ORDER BY created_at ASC
  `;
  return rows.map((r) => ({
    room: r.room,
    sender: r.sender,
    content: r.content,
    isFromAgent: r.is_from_agent,
    createdAt: String(r.created_at),
  }));
}

export async function getRoomStats(): Promise<RoomStats[]> {
  const sql = getSql();
  const rows = await sql`
    SELECT
      s.room,
      COUNT(DISTINCT s.id)::int AS sessions,
      COUNT(m.id)::int AS messages,
      MAX(m.created_at) AS last_activity
    FROM sessions s
    LEFT JOIN messages m ON m.session_id = s.id
    GROUP BY s.room
    ORDER BY MAX(m.created_at) DESC NULLS LAST
  `;
  return rows.map((r) => ({
    room: r.room,
    sessions: r.sessions,
    messages: r.messages,
    lastActivity: r.last_activity ? String(r.last_activity) : null,
  }));
}
