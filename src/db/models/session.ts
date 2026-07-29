import { getSql } from "../connection";

/** Escape regex metacharacters so a literal string can be used in a PostgreSQL ~ pattern. */
export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

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

export async function listRecent(limit = 10, room?: string): Promise<SessionSummary[]> {
  if (room) return getRecent(room, limit);
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

export async function setSummary(id: string, summary: string): Promise<void> {
  const sql = getSql();
  await sql`UPDATE sessions SET summary = ${summary} WHERE id = ${id}`;
}

export async function getRecentSummaries(
  room: string,
  limit = 3,
): Promise<Array<{ summary: string; updatedAt: string }>> {
  const sql = getSql();
  // Match summaries from sessions in the same channel (e.g. slack-dm-U...-*)
  // by extracting the room prefix (everything before the last -N index)
  const prefix = room.replace(/-\d+$/, "");
  const pattern = `^${escapeRegex(prefix)}-\\d+$`;
  const rows = await sql`
    SELECT summary, updated_at
    FROM sessions
    WHERE room ~ ${pattern}
      AND summary IS NOT NULL
      AND id != ${""}
    ORDER BY updated_at DESC
    LIMIT ${limit}
  `;
  return rows.map((r) => ({
    summary: String(r.summary),
    updatedAt: String(r.updated_at),
  }));
}

export interface UsageTotals {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  models: string[];
  providers: string[];
}

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

/**
 * Fold a result's per-model usage into totals. `provider` matters because a
 * chain that fails over makes the model name alone ambiguous about who served
 * the turn.
 */
export function summarizeModelUsage(modelUsage: unknown): UsageTotals {
  const totals: UsageTotals = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    models: [],
    providers: [],
  };
  if (!modelUsage || typeof modelUsage !== "object") return totals;

  const models = new Set<string>();
  const providers = new Set<string>();
  for (const [key, raw] of Object.entries(modelUsage as Record<string, unknown>)) {
    const usage = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    models.add(str(usage.canonicalModel) ?? key);
    const provider = str(usage.provider);
    if (provider) providers.add(provider);
    totals.inputTokens += num(usage.inputTokens);
    totals.outputTokens += num(usage.outputTokens);
    totals.cacheReadTokens += num(usage.cacheReadInputTokens);
    totals.cacheCreationTokens += num(usage.cacheCreationInputTokens);
  }
  totals.models = [...models];
  totals.providers = [...providers];
  return totals;
}

export async function accumulateMetadata(id: string, resultMeta: Record<string, unknown>): Promise<void> {
  const sql = getSql();

  const {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheCreationTokens,
    models: newModels,
    providers: newProviders,
  } = summarizeModelUsage(resultMeta.model_usage);

  // Bind deltas as jsonb via sql.json — pre-stringifying would store a
  // double-encoded string scalar, making every `->>` extraction return NULL
  // and silently zeroing all accumulated totals.
  const delta = sql.json({
    total_cost_usd: (resultMeta.cost_usd as number) || 0,
    total_turns: (resultMeta.turns as number) || 0,
    total_duration_ms: (resultMeta.duration_ms as number) || 0,
    total_duration_api_ms: (resultMeta.duration_api_ms as number) || 0,
    total_input_tokens: inputTokens,
    total_output_tokens: outputTokens,
    total_cache_read_tokens: cacheReadTokens,
    total_cache_creation_tokens: cacheCreationTokens,
    message_count: 1,
    models_used: newModels,
    providers_used: newProviders,
    channel: (resultMeta.channel as string) || null,
  });
  const modelsDelta = sql.json(newModels);
  const providersDelta = sql.json(newProviders);

  // Atomic accumulate — no read-then-write race
  await sql`
    UPDATE sessions SET metadata = jsonb_build_object(
      'total_cost_usd',              COALESCE((metadata->>'total_cost_usd')::real, 0)              + (${delta}->>'total_cost_usd')::real,
      'total_turns',                  COALESCE((metadata->>'total_turns')::int, 0)                  + (${delta}->>'total_turns')::int,
      'total_duration_ms',            COALESCE((metadata->>'total_duration_ms')::real, 0)            + (${delta}->>'total_duration_ms')::real,
      'total_duration_api_ms',        COALESCE((metadata->>'total_duration_api_ms')::real, 0)        + (${delta}->>'total_duration_api_ms')::real,
      'total_input_tokens',           COALESCE((metadata->>'total_input_tokens')::int, 0)            + (${delta}->>'total_input_tokens')::int,
      'total_output_tokens',          COALESCE((metadata->>'total_output_tokens')::int, 0)           + (${delta}->>'total_output_tokens')::int,
      'total_cache_read_tokens',      COALESCE((metadata->>'total_cache_read_tokens')::int, 0)       + (${delta}->>'total_cache_read_tokens')::int,
      'total_cache_creation_tokens',  COALESCE((metadata->>'total_cache_creation_tokens')::int, 0)   + (${delta}->>'total_cache_creation_tokens')::int,
      'message_count',                COALESCE((metadata->>'message_count')::int, 0)                 + 1,
      'models_used',                  (SELECT COALESCE(jsonb_agg(DISTINCT e), '[]'::jsonb)
                                         FROM jsonb_array_elements(COALESCE(metadata->'models_used', '[]'::jsonb) || ${modelsDelta}) AS e),
      'providers_used',               (SELECT COALESCE(jsonb_agg(DISTINCT e), '[]'::jsonb)
                                         FROM jsonb_array_elements(COALESCE(metadata->'providers_used', '[]'::jsonb) || ${providersDelta}) AS e),
      'channel',                      COALESCE(metadata->>'channel', ${(resultMeta.channel as string) || null})
    )
    WHERE id = ${id}
  `;
}

/** Max numeric suffix among rooms matching `${prefix}-N`. Used by rotateRoom() to allocate idx+1 without collisions. */
export async function getLatestRoomIndex(prefix: string): Promise<number> {
  const sql = getSql();
  const pattern = `^${escapeRegex(prefix)}-\\d+$`;
  const rows = await sql`SELECT room FROM sessions WHERE room ~ ${pattern}`;
  let max = 0;
  for (const row of rows) {
    const parts = (row.room as string).split("-");
    const idx = parseInt(parts[parts.length - 1], 10);
    if (!isNaN(idx) && idx > max) max = idx;
  }
  return max;
}

/** How many messages of this session the consolidator has already read. */
export async function getConsolidatedCount(sessionId: string): Promise<number> {
  const sql = getSql();
  const rows = await sql`SELECT consolidated_count FROM sessions WHERE id = ${sessionId}`;
  return rows.length > 0 ? Number(rows[0].consolidated_count ?? 0) : 0;
}

export async function setConsolidatedCount(sessionId: string, count: number): Promise<void> {
  const sql = getSql();
  await sql`UPDATE sessions SET consolidated_count = ${count} WHERE id = ${sessionId}`;
}
