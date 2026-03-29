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

export async function getRecentSummaries(room: string, limit = 3): Promise<Array<{ summary: string; updatedAt: string }>> {
  const sql = getSql();
  // Match summaries from sessions in the same channel (e.g. slack-dm-U...-*)
  // by extracting the room prefix (everything before the last -N index)
  const prefix = room.replace(/-\d+$/, "");
  const rows = await sql`
    SELECT summary, updated_at
    FROM sessions
    WHERE room LIKE ${prefix + "-%"}
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

export async function accumulateMetadata(id: string, resultMeta: Record<string, unknown>): Promise<void> {
  const sql = getSql();

  const modelUsage = resultMeta.model_usage as Record<string, Record<string, number>> | undefined;
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheCreationTokens = 0;
  const newModels: string[] = [];
  if (modelUsage) {
    for (const [model, usage] of Object.entries(modelUsage)) {
      newModels.push(model);
      inputTokens += usage.inputTokens || 0;
      outputTokens += usage.outputTokens || 0;
      cacheReadTokens += usage.cacheReadInputTokens || 0;
      cacheCreationTokens += usage.cacheCreationInputTokens || 0;
    }
  }

  const delta = JSON.stringify({
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
    channel: resultMeta.channel || null,
  });

  // Atomic accumulate — no read-then-write race
  await sql`
    UPDATE sessions SET metadata = jsonb_build_object(
      'total_cost_usd',              COALESCE((metadata->>'total_cost_usd')::real, 0)              + (${delta}::jsonb->>'total_cost_usd')::real,
      'total_turns',                  COALESCE((metadata->>'total_turns')::int, 0)                  + (${delta}::jsonb->>'total_turns')::int,
      'total_duration_ms',            COALESCE((metadata->>'total_duration_ms')::real, 0)            + (${delta}::jsonb->>'total_duration_ms')::real,
      'total_duration_api_ms',        COALESCE((metadata->>'total_duration_api_ms')::real, 0)        + (${delta}::jsonb->>'total_duration_api_ms')::real,
      'total_input_tokens',           COALESCE((metadata->>'total_input_tokens')::int, 0)            + (${delta}::jsonb->>'total_input_tokens')::int,
      'total_output_tokens',          COALESCE((metadata->>'total_output_tokens')::int, 0)           + (${delta}::jsonb->>'total_output_tokens')::int,
      'total_cache_read_tokens',      COALESCE((metadata->>'total_cache_read_tokens')::int, 0)       + (${delta}::jsonb->>'total_cache_read_tokens')::int,
      'total_cache_creation_tokens',  COALESCE((metadata->>'total_cache_creation_tokens')::int, 0)   + (${delta}::jsonb->>'total_cache_creation_tokens')::int,
      'message_count',                COALESCE((metadata->>'message_count')::int, 0)                 + 1,
      'models_used',                  COALESCE(metadata->'models_used', '[]'::jsonb) || ${JSON.stringify(newModels)}::jsonb,
      'channel',                      COALESCE(metadata->>'channel', ${(resultMeta.channel as string) || null})
    )
    WHERE id = ${id}
  `;
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
