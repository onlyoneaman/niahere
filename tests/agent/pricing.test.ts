import { describe, expect, test } from "bun:test";
import { estimateCodexCost, rateFor, CODEX_RATES } from "../../src/agent/pricing";

describe("estimateCodexCost", () => {
  test("prices a turn at published list rates", () => {
    // 1M uncached in @ $5 + 1M out @ $30 = $35
    expect(estimateCodexCost("gpt-5.6-sol", { inputTokens: 1_000_000, outputTokens: 1_000_000 })).toBeCloseTo(35, 6);
  });

  test("cache reads take the 90% discount, not the input rate", () => {
    // 1M cache reads on sol: $0.50, not $5
    expect(estimateCodexCost("gpt-5.6-sol", { cacheReadInputTokens: 1_000_000 })).toBeCloseTo(0.5, 6);
  });

  test("cache writes bill above input, at 1.25x", () => {
    expect(estimateCodexCost("gpt-5.6-sol", { cacheCreationInputTokens: 1_000_000 })).toBeCloseTo(6.25, 6);
  });

  test("the cheap tier is two orders of magnitude below the flagship", () => {
    const sol = estimateCodexCost("gpt-5.6-sol", { inputTokens: 1_000_000 })!;
    const luna = estimateCodexCost("gpt-5.6-luna", { inputTokens: 1_000_000 })!;
    expect(sol / luna).toBeCloseTo(25, 6);
  });

  test("an unknown model stays unpriced rather than being valued at zero", () => {
    expect(estimateCodexCost("gpt-5.5", { inputTokens: 1_000_000 })).toBeNull();
    expect(estimateCodexCost(undefined, { inputTokens: 1_000_000 })).toBeNull();
    // A bare `codex` entry never recorded which model answered.
    expect(estimateCodexCost("default", { inputTokens: 1_000_000 })).toBeNull();
  });

  test("a priced model with no tokens is $0, which is different from unknown", () => {
    expect(estimateCodexCost("gpt-5.6-sol", {})).toBe(0);
  });

  test("model lookup ignores case and surrounding space", () => {
    expect(rateFor("  GPT-5.6-Sol ")).toEqual(CODEX_RATES["gpt-5.6-sol"]!);
  });

  test("negative or junk counts do not subtract from the estimate", () => {
    expect(estimateCodexCost("gpt-5.6-sol", { inputTokens: -5_000_000, outputTokens: 1_000_000 })).toBeCloseTo(30, 6);
  });

  test("every published rate discounts cache reads below input", () => {
    for (const [model, rate] of Object.entries(CODEX_RATES)) {
      expect(rate.cachedInput, model).toBeLessThan(rate.input);
      expect(rate.cacheWrite, model).toBeGreaterThan(rate.input);
      expect(rate.output, model).toBeGreaterThan(rate.input);
    }
  });
});
