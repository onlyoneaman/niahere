import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { getSql, closeDb } from "../../src/db/connection";
import { runMigrations } from "../../src/db/migrate";
import * as Session from "../../src/db/models/session";
import * as Message from "../../src/db/models/message";
import { queryUsage } from "../../src/db/models/usage";

const ROOM = `usage-test-${Date.now()}`;

/** One agent turn carrying the metadata shape both backends emit. */
async function turn(sessionId: string, modelUsage: Record<string, unknown>, createdAt?: string) {
  const id = await Message.save({
    sessionId,
    room: ROOM,
    sender: "nia",
    content: "reply",
    isFromAgent: true,
    metadata: { model_usage: modelUsage },
  });
  if (createdAt) await getSql()`UPDATE messages SET created_at = ${createdAt} WHERE id = ${id}`;
}

describe("queryUsage", () => {
  beforeAll(async () => {
    await runMigrations();
    const sql = getSql();
    await sql`DELETE FROM messages WHERE room = ${ROOM}`;

    const a = `${ROOM}-s1`;
    await Session.create(a, ROOM);
    await turn(
      a,
      {
        "claude-sonnet-5": {
          provider: "firstParty",
          canonicalModel: "claude-sonnet-5",
          costUSD: 0.25,
          inputTokens: 10,
          outputTokens: 4,
          cacheReadInputTokens: 900,
          cacheCreationInputTokens: 100,
        },
      },
      "2026-07-20T10:00:00Z",
    );
    await turn(
      a,
      { "gpt-5-codex": { provider: "codex", inputTokens: 60, outputTokens: 5, cacheReadInputTokens: 40 } },
      "2026-07-20T11:00:00Z",
    );
    await turn(
      a,
      { "claude-sonnet-5": { provider: "claude", costUSD: 0.5, inputTokens: 2, outputTokens: 1 } },
      "2026-07-22T10:00:00Z",
    );
  });

  afterAll(async () => {
    await getSql()`DELETE FROM messages WHERE room = ${ROOM}`;
    await closeDb();
  });

  const rows = () => queryUsage({ since: new Date("2026-07-01T00:00:00Z"), room: ROOM });

  test("reads per-model usage out of the message ledger", async () => {
    const all = await rows();
    expect(all.length).toBeGreaterThan(0);
    const codex = all.find((r) => r.provider === "codex")!;
    expect(codex).toMatchObject({ model: "gpt-5-codex", inputTokens: 60, cacheReadTokens: 40 });
  });

  test("the SDK's deployment target folds into the backend that ran it", async () => {
    // History written before providers were attributed correctly says
    // firstParty; it is the same backend and must not split the totals.
    const all = await rows();
    expect(all.map((r) => r.provider)).not.toContain("firstParty");
    const claude = all.filter((r) => r.provider === "claude");
    expect(claude.reduce((n, r) => n + r.inputTokens, 0)).toBe(12);
  });

  test("cost is summed only where it is known", async () => {
    const all = await rows();
    const claude = all.filter((r) => r.provider === "claude");
    expect(claude.reduce((n, r) => n + (r.costUsd ?? 0), 0)).toBeCloseTo(0.75, 5);

    const codex = all.find((r) => r.provider === "codex")!;
    expect(codex.costUsd).toBeNull();
    expect(codex.unpricedTurns).toBe(1);
  });

  test("splits by day so a range can be charted", async () => {
    const days = new Set((await rows()).map((r) => r.day));
    expect(days).toEqual(new Set(["2026-07-20", "2026-07-22"]));
  });

  test("`since` excludes older turns", async () => {
    const recent = await queryUsage({ since: new Date("2026-07-21T00:00:00Z"), room: ROOM });
    expect(new Set(recent.map((r) => r.day))).toEqual(new Set(["2026-07-22"]));
  });

  test("a turn with no usage metadata is skipped, not counted as zero", async () => {
    const sql = getSql();
    await Message.save({ sessionId: `${ROOM}-s1`, room: ROOM, sender: "nia", content: "x", isFromAgent: true });
    const total = (await rows()).reduce((n, r) => n + r.turns, 0);
    expect(total).toBe(3);
    await sql`DELETE FROM messages WHERE room = ${ROOM} AND content = 'x'`;
  });
});
