import { getSql } from "../connection";

/**
 * How often a running turn re-stamps its row. Called from the event loops
 * rather than a timer on purpose: a timer outlives the work it describes, so a
 * process that died mid-turn would keep its row looking alive. A loop that
 * stops simply stops pinging.
 */
export const PING_INTERVAL_MS = 30_000;

/**
 * Silence longer than this means the turn is gone, not slow — several missed
 * pings, not one. Nothing read this column for a long time, so a row left
 * behind by a crash (or a test aimed at the wrong database) counted as live
 * work forever, and blocked the very restart that clears it.
 */
export const STALE_AFTER_MS = 3 * 60_000;

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

/** An unreadable timestamp counts as live: `--force` is the escape hatch, and
 *  killing real work is the worse mistake. */
export function isStale(lastPing: string, now: number = Date.now()): boolean {
  const t = Date.parse(lastPing);
  return Number.isFinite(t) ? now - t > STALE_AFTER_MS : false;
}

const lastTouch = new Map<string, number>();

export interface TouchDeps {
  now?: number;
  seen?: Map<string, number>;
  ping?: (room: string) => Promise<void>;
}

/** Re-stamp a running turn, at most once per interval. Safe to call from a hot
 *  loop — the chat path fires per token. */
export async function throttledTouch(room: string, deps: TouchDeps = {}): Promise<void> {
  const now = deps.now ?? Date.now();
  const seen = deps.seen ?? lastTouch;
  const previous = seen.get(room);
  if (previous !== undefined && now - previous < PING_INTERVAL_MS) return;
  seen.set(room, now);
  await (deps.ping ?? ping)(room);
}

/** Forget a room's throttle state so a later turn pings immediately. */
export function forgetTouch(room: string): void {
  lastTouch.delete(room);
}

export async function unregister(room: string): Promise<void> {
  forgetTouch(room);
  const sql = getSql();
  await sql`DELETE FROM active_engines WHERE room = ${room}`;
}

export async function clearAll(): Promise<void> {
  lastTouch.clear();
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
