import { describe, expect, test } from "bun:test";
import { compactTokens, formatCost, parseUsageArgs, rollup } from "../../src/cli/usage";
import type { UsageRow } from "../../src/db/models/usage";

const row = (over: Partial<UsageRow>): UsageRow => ({
  day: "2026-07-20",
  room: "slack-tech",
  model: "claude-sonnet-5",
  provider: "claude",
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  costUsd: 0,
  turns: 1,
  unpricedTurns: 0,
  ...over,
});

describe("rollup", () => {
  const rows = [
    row({ day: "2026-07-20", model: "claude-sonnet-5", inputTokens: 10, costUsd: 0.5 }),
    row({ day: "2026-07-20", model: "claude-haiku-4-5", inputTokens: 5, costUsd: 0.1 }),
    row({ day: "2026-07-21", model: "claude-sonnet-5", inputTokens: 7, costUsd: 0.2 }),
  ];

  test("groups by the requested dimension", () => {
    expect(rollup(rows, "day").map((b) => b.key)).toEqual(["2026-07-20", "2026-07-21"]);
    expect(rollup(rows, "model").map((b) => b.key).sort()).toEqual(["claude-haiku-4-5", "claude-sonnet-5"]);
  });

  test("sums tokens, cost and turns inside a bucket", () => {
    const [first] = rollup(rows, "day");
    expect(first).toMatchObject({ inputTokens: 15, costUsd: 0.6, turns: 2 });
  });

  test("orders days oldest first and everything else by spend", () => {
    expect(rollup(rows, "day").map((b) => b.key)).toEqual(["2026-07-20", "2026-07-21"]);
    expect(rollup(rows, "model").map((b) => b.key)).toEqual(["claude-sonnet-5", "claude-haiku-4-5"]);
  });

  test("a bucket where nothing was priced reports no cost, not zero", () => {
    const [only] = rollup([row({ model: "gpt-5.6-sol", costUsd: null, unpricedTurns: 1 })], "model");
    expect(only!.costUsd).toBeNull();
    expect(only!.unpricedTurns).toBe(1);
  });

  test("a partly-priced bucket keeps the known cost and flags the rest", () => {
    const mixed = rollup(
      [row({ costUsd: 0.4 }), row({ model: "gpt-5.6-sol", costUsd: null, unpricedTurns: 1 })],
      "day",
    );
    expect(mixed[0]).toMatchObject({ costUsd: 0.4, unpricedTurns: 1, turns: 2 });
  });

  test("no rows is an empty rollup, not a zero row", () => {
    expect(rollup([], "day")).toEqual([]);
  });
});

describe("compactTokens", () => {
  test("scales to K and M so columns stay narrow", () => {
    expect(compactTokens(0)).toBe("0");
    expect(compactTokens(945)).toBe("945");
    expect(compactTokens(1_200)).toBe("1.2K");
    expect(compactTokens(1_385_500_000)).toBe("1385.5M");
  });
});

describe("formatCost", () => {
  test("an unknown cost is never shown as a number", () => {
    expect(formatCost(null)).toBe("—");
  });

  test("small amounts keep enough precision to be non-zero", () => {
    expect(formatCost(0.0006)).toBe("$0.0006");
    expect(formatCost(121.3)).toBe("$121.30");
  });
});

describe("parseUsageArgs", () => {
  test("defaults to the last week grouped by day", () => {
    expect(parseUsageArgs([])).toMatchObject({ days: 7, by: "day", json: false });
  });

  test("reads the dimensions worth slicing on", () => {
    expect(parseUsageArgs(["--days", "30", "--by", "model", "--json"])).toMatchObject({
      days: 30,
      by: "model",
      json: true,
    });
    expect(parseUsageArgs(["--room", "slack-tech"]).room).toBe("slack-tech");
  });

  test("an unusable --days is ignored rather than silently querying nothing", () => {
    expect(parseUsageArgs(["--days", "0"]).days).toBe(7);
    expect(parseUsageArgs(["--days", "abc"]).days).toBe(7);
  });

  test("an unknown --by is rejected rather than grouping on nothing", () => {
    expect(() => parseUsageArgs(["--by", "nonsense"])).toThrow(/--by/);
  });
});
