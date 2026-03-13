import { getSql } from "../connection";

export interface SaveMessageParams {
  sessionId: string;
  room: string;
  sender: string;
  content: string;
  isFromAgent: boolean;
}

export async function save(params: SaveMessageParams): Promise<void> {
  const sql = getSql();
  await sql`
    INSERT INTO messages (session_id, room, sender, content, is_from_agent)
    VALUES (${params.sessionId}, ${params.room}, ${params.sender}, ${params.content}, ${params.isFromAgent})
  `;
}

export interface RoomStats {
  room: string;
  sessions: number;
  messages: number;
  lastActivity: string | null;
}

export interface RecentMessage {
  room: string;
  sender: string;
  content: string;
  createdAt: string;
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
