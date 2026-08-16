import { describe, expect, test } from "bun:test";
import { isStale, throttledTouch, PING_INTERVAL_MS, STALE_AFTER_MS } from "../../src/db/models/active_engine";
import { partitionEngines } from "../../src/core/engine-guard";
import type { ActiveEngine } from "../../src/db/models/active_engine";

const NOW = Date.parse("2026-08-16T12:00:00Z");
const at = (msAgo: number) => new Date(NOW - msAgo).toISOString();

const engine = (room: string, msAgo: number): ActiveEngine => ({
  room,
  channel: "slack",
  startedAt: at(msAgo),
  lastPing: at(msAgo),
});

describe("isStale", () => {
  test("a turn pinging right now is live", () => {
    expect(isStale(at(0), NOW)).toBe(false);
  });

  test("a turn still pinging within the window is live, even after many minutes", () => {
    // Jobs routinely run 3–6 minutes. Only the ping matters, not the age.
    expect(isStale(at(STALE_AFTER_MS - 1_000), NOW)).toBe(false);
  });

  test("a row nobody has pinged past the window is stale", () => {
    expect(isStale(at(STALE_AFTER_MS + 1_000), NOW)).toBe(true);
  });

  test("two days of silence is emphatically stale", () => {
    // The literal case that blocked stop/restart/update on the mini.
    expect(isStale(at(2 * 24 * 3_600_000), NOW)).toBe(true);
  });

  test("an unreadable timestamp counts as live — --force is the escape, data loss is not", () => {
    expect(isStale("not a date", NOW)).toBe(false);
  });
});

describe("partitionEngines", () => {
  test("keeps live engines and sets stale ones aside", () => {
    const { live, stale } = partitionEngines(
      [engine("busy", 1_000), engine("leaked", 2 * 24 * 3_600_000), engine("alsoBusy", 10_000)],
      NOW,
    );
    expect(live.map((e) => e.room)).toEqual(["busy", "alsoBusy"]);
    expect(stale.map((e) => e.room)).toEqual(["leaked"]);
  });

  test("a table of nothing but leaked rows counts as idle", () => {
    // This is the whole bug: two dead rows must not block the restart that
    // would have cleared them.
    const { live, stale } = partitionEngines(
      [engine("test-active-one", 2 * 24 * 3_600_000), engine("test-active-two", 2 * 24 * 3_600_000)],
      NOW,
    );
    expect(live).toHaveLength(0);
    expect(stale).toHaveLength(2);
  });

  test("genuinely running work still blocks", () => {
    const { live } = partitionEngines([engine("running", 5_000)], NOW);
    expect(live).toHaveLength(1);
  });

  test("an empty table is idle", () => {
    expect(partitionEngines([], NOW)).toEqual({ live: [], stale: [] });
  });
});

describe("throttledTouch", () => {
  function harness() {
    const pinged: string[] = [];
    const seen = new Map<string, number>();
    return {
      pinged,
      touch: (room: string, now: number) =>
        throttledTouch(room, { now, seen, ping: async (r) => void pinged.push(r) }),
      seen,
    };
  }

  test("pings on first sight so a new turn is immediately live", async () => {
    const h = harness();
    await h.touch("room", NOW);
    expect(h.pinged).toEqual(["room"]);
  });

  test("does not hit the database on every event", async () => {
    // The chat loop fires per token; pinging each time would be absurd.
    const h = harness();
    await h.touch("room", NOW);
    await h.touch("room", NOW + 1_000);
    await h.touch("room", NOW + 2_000);
    expect(h.pinged).toEqual(["room"]);
  });

  test("pings again once the interval has passed, keeping a long turn live", async () => {
    const h = harness();
    await h.touch("room", NOW);
    await h.touch("room", NOW + PING_INTERVAL_MS + 1);
    expect(h.pinged).toEqual(["room", "room"]);
  });

  test("throttles per room, not globally", async () => {
    const h = harness();
    await h.touch("roomA", NOW);
    await h.touch("roomB", NOW);
    expect(h.pinged).toEqual(["roomA", "roomB"]);
  });

  test("pings often enough that a live turn never reads as stale", () => {
    // If the interval ever crept past the window, every long turn would look
    // dead and the guard would wave through a restart that kills real work.
    expect(PING_INTERVAL_MS).toBeLessThan(STALE_AFTER_MS / 2);
  });
});
