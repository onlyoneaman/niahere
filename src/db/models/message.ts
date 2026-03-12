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
