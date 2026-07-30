import { withDb } from "../db/with-db";
import { queryUsage, type UsageRow } from "../db/models/usage";
import { getConfig } from "../utils/config";
import { BOLD, DIM, RESET, fail } from "../utils/cli";
import { errMsg } from "../utils/errors";

export type Dimension = "day" | "model" | "provider" | "room";

const DIMENSIONS: Dimension[] = ["day", "model", "provider", "room"];

export interface UsageOptions {
  days: number;
  by: Dimension;
  room?: string;
  json: boolean;
}

export interface UsageBucket {
  key: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** null when nothing in the bucket carried a cost. */
  costUsd: number | null;
  turns: number;
  unpricedTurns: number;
}

export function parseUsageArgs(argv: string[]): UsageOptions {
  const opts: UsageOptions = { days: 7, by: "day", json: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const value = argv[i + 1];
    if (arg === "--json") {
      opts.json = true;
    } else if (arg === "--days" && value) {
      const parsed = Number.parseInt(value, 10);
      if (Number.isInteger(parsed) && parsed > 0) opts.days = parsed;
      i += 1;
    } else if (arg === "--by" && value) {
      if (!DIMENSIONS.includes(value as Dimension)) throw new Error(`--by must be one of: ${DIMENSIONS.join(", ")}`);
      opts.by = value as Dimension;
      i += 1;
    } else if (arg === "--room" && value) {
      opts.room = value;
      i += 1;
    }
  }
  return opts;
}

export function rollup(rows: UsageRow[], by: Dimension): UsageBucket[] {
  const byKey = new Map<string, UsageBucket>();
  for (const row of rows) {
    const key = row[by];
    const seen = byKey.get(key);
    if (!seen) {
      byKey.set(key, {
        key,
        inputTokens: row.inputTokens,
        outputTokens: row.outputTokens,
        cacheReadTokens: row.cacheReadTokens,
        cacheWriteTokens: row.cacheWriteTokens,
        costUsd: row.costUsd,
        turns: row.turns,
        unpricedTurns: row.unpricedTurns,
      });
      continue;
    }
    seen.inputTokens += row.inputTokens;
    seen.outputTokens += row.outputTokens;
    seen.cacheReadTokens += row.cacheReadTokens;
    seen.cacheWriteTokens += row.cacheWriteTokens;
    seen.turns += row.turns;
    seen.unpricedTurns += row.unpricedTurns;
    // A known cost survives an unknown one beside it; only an all-unknown
    // bucket reports nothing.
    seen.costUsd = seen.costUsd === null && row.costUsd === null ? null : (seen.costUsd ?? 0) + (row.costUsd ?? 0);
  }

  const buckets = [...byKey.values()];
  return by === "day"
    ? buckets.sort((a, b) => a.key.localeCompare(b.key))
    : buckets.sort((a, b) => (b.costUsd ?? 0) - (a.costUsd ?? 0) || b.turns - a.turns);
}

export function compactTokens(n: number): string {
  if (n >= 1_000_000) return `${round(n / 1_000_000)}M`;
  if (n >= 1_000) return `${round(n / 1_000)}K`;
  return String(n);
}

function round(n: number): string {
  return n.toFixed(1).replace(/\.0$/, "");
}

export function formatCost(cost: number | null): string {
  if (cost === null) return "—";
  // Sub-cent turns are common; rounding them to $0.00 hides real spend.
  return cost > 0 && cost < 0.01 ? `$${cost.toFixed(4)}` : `$${cost.toFixed(2)}`;
}

const COLUMNS: [string, (b: UsageBucket) => string][] = [
  ["Turns", (b) => String(b.turns)],
  ["Input", (b) => compactTokens(b.inputTokens)],
  ["Output", (b) => compactTokens(b.outputTokens)],
  ["Cache rd", (b) => compactTokens(b.cacheReadTokens)],
  ["Cache wr", (b) => compactTokens(b.cacheWriteTokens)],
  ["Cost", (b) => formatCost(b.costUsd)],
];

export function renderTable(buckets: UsageBucket[], label: string): string[] {
  const header = [label, ...COLUMNS.map(([name]) => name)];
  const body = buckets.map((b) => [b.key, ...COLUMNS.map(([, read]) => read(b))]);
  const total = buckets.reduce<UsageBucket>((sum, b) => {
    sum.inputTokens += b.inputTokens;
    sum.outputTokens += b.outputTokens;
    sum.cacheReadTokens += b.cacheReadTokens;
    sum.cacheWriteTokens += b.cacheWriteTokens;
    sum.turns += b.turns;
    sum.unpricedTurns += b.unpricedTurns;
    sum.costUsd = sum.costUsd === null && b.costUsd === null ? null : (sum.costUsd ?? 0) + (b.costUsd ?? 0);
    return sum;
  }, emptyBucket("Total"));

  const rows = [header, ...body, [total.key, ...COLUMNS.map(([, read]) => read(total))]];
  const widths = header.map((_, col) => Math.max(...rows.map((r) => r[col]!.length)));
  const line = (cells: string[]) =>
    cells.map((cell, col) => (col === 0 ? cell.padEnd(widths[col]!) : cell.padStart(widths[col]!))).join("  ");

  const out = [`${BOLD}${line(header)}${RESET}`, ...body.map(line), `${BOLD}${line(rows.at(-1)!)}${RESET}`];
  if (total.unpricedTurns > 0) {
    out.push(`${DIM}${total.unpricedTurns} of ${total.turns} turns report no cost (codex bills no per-token price)${RESET}`);
  }
  return out;
}

function emptyBucket(key: string): UsageBucket {
  return {
    key,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd: null,
    turns: 0,
    unpricedTurns: 0,
  };
}

export async function usageCommand(argv: string[]): Promise<void> {
  let opts: UsageOptions;
  try {
    opts = parseUsageArgs(argv);
  } catch (e) {
    fail(errMsg(e));
  }
  const since = new Date(Date.now() - opts.days * 24 * 60 * 60 * 1000);
  const timezone = getConfig().timezone || "UTC";

  const rows = await withDb(() =>
    queryUsage({ since, ...(opts.room !== undefined ? { room: opts.room } : {}), timezone }),
  );

  if (opts.json) {
    console.log(JSON.stringify({ since: since.toISOString(), timezone, rows }, null, 2));
    return;
  }

  if (rows.length === 0) {
    console.log(`No recorded usage in the last ${opts.days} days${opts.room ? ` for ${opts.room}` : ""}.`);
    return;
  }

  const scope = opts.room ? ` · ${opts.room}` : "";
  console.log(`\nUsage — last ${opts.days} days${scope} (${timezone})\n`);
  for (const line of renderTable(rollup(rows, opts.by), title(opts.by))) console.log(line);

  if (opts.by === "day") {
    console.log("\nBy model");
    for (const line of renderTable(rollup(rows, "model"), "Model")) console.log(`  ${line}`);
  }
  console.log();
}

function title(by: Dimension): string {
  return by === "day" ? "Day" : by[0]!.toUpperCase() + by.slice(1);
}
