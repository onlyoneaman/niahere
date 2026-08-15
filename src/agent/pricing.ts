/**
 * Published API list rates, USD per million tokens.
 *
 * Codex signed in with a ChatGPT plan bills no tokens — the subscription covers
 * it. So anything derived here is an estimate of what the same work would have
 * cost on the API, and it is kept strictly apart from reported cost: a bill and
 * a projection must never be summed into one number.
 *
 * It earns its place anyway. Codex reporting no cost meant a total Claude
 * outage read as weekly spend falling $552 → $0.00, which looks like thrift
 * rather than failure. An estimate makes the traffic visible in the one unit
 * anybody watches.
 *
 * Rates verified 15 Aug 2026, after OpenAI's 30 July cut. Cache reads take a
 * 90% discount off input; cache writes bill at 1.25x input on GPT-5.6 and later.
 * A model with no published rate stays unpriced rather than being valued at
 * zero — the whole point is not to invent a number.
 */

export interface TokenRate {
  /** USD per million uncached input tokens. */
  input: number;
  /** USD per million cache-read tokens. */
  cachedInput: number;
  /** USD per million output tokens. */
  output: number;
  /** USD per million cache-write tokens. */
  cacheWrite: number;
}

export const CODEX_RATES: Readonly<Record<string, TokenRate>> = {
  "gpt-5.6-sol": { input: 5, cachedInput: 0.5, output: 30, cacheWrite: 6.25 },
  "gpt-5.6-terra": { input: 2, cachedInput: 0.2, output: 12, cacheWrite: 2.5 },
  "gpt-5.6-luna": { input: 0.2, cachedInput: 0.02, output: 1.2, cacheWrite: 0.25 },
};

export interface TokenCounts {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
}

const PER_MILLION = 1_000_000;
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);

export function rateFor(model: string | undefined | null): TokenRate | null {
  const key = (model ?? "").trim().toLowerCase();
  return CODEX_RATES[key] ?? null;
}

/**
 * What these tokens would have cost on the API, or null when the model has no
 * published rate — including the bare `codex`/`default` entry, where nobody
 * recorded which model actually answered.
 */
export function estimateCodexCost(model: string | undefined | null, usage: TokenCounts): number | null {
  const rate = rateFor(model);
  if (!rate) return null;
  const usd =
    (num(usage.inputTokens) * rate.input +
      num(usage.cacheReadInputTokens) * rate.cachedInput +
      num(usage.outputTokens) * rate.output +
      num(usage.cacheCreationInputTokens) * rate.cacheWrite) /
    PER_MILLION;
  return usd;
}
