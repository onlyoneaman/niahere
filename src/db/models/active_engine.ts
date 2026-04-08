import { getSql } from "../connection";

export interface ActiveEngine {
  room: string;
  channel: string;
  startedAt: string;
  lastPing: string;
}

export async function register(room: string, channel: string): Promise<void> {
  const sql = getSql();
  await sql`
    INSERT INTO active_engines (room, channel, started_at, last_ping)
    VALUES (${room}, ${channel}, NOW(), NOW())
    ON CONFLICT (room) DO UPDATE SET last_ping = NOW()
  `;
}

export async function ping(room: string): Promise<void> {
  const sql = getSql();
  await sql`UPDATE active_engines SET last_ping = NOW() WHERE room = ${room}`;
}

export async function unregister(room: string): Promise<void> {
  const sql = getSql();
  await sql`DELETE FROM active_engines WHERE room = ${room}`;
}

export async function clearStale(
  maxAgeMs: number = 5 * 60 * 1000,
): Promise<void> {
  const sql = getSql();
  await sql`DELETE FROM active_engines WHERE last_ping < NOW() - ${maxAgeMs / 1000}::int * interval '1 second'`;
}

export async function clearAll(): Promise<void> {
  const sql = getSql();
  await sql`DELETE FROM active_engines`;
}

export async function list(): Promise<ActiveEngine[]> {
  const sql = getSql();
  const rows =
    await sql`SELECT room, channel, started_at, last_ping FROM active_engines ORDER BY started_at`;
  return rows.map((r) => ({
    room: r.room,
    channel: r.channel,
    startedAt: String(r.started_at),
    lastPing: String(r.last_ping),
  }));
}
