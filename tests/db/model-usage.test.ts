import { describe, expect, test } from "bun:test";
import { summarizeModelUsage } from "../../src/db/models/session";

describe("summarizeModelUsage", () => {
  test("sums token counts across models", () => {
    const totals = summarizeModelUsage({
      "claude-sonnet-5": { inputTokens: 100, outputTokens: 20, cacheReadInputTokens: 900, cacheCreationInputTokens: 50 },
      "claude-haiku-4-5": { inputTokens: 10, outputTokens: 2, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 },
    });
    expect(totals).toMatchObject({
      inputTokens: 110,
      outputTokens: 22,
      cacheReadTokens: 900,
      cacheCreationTokens: 50,
    });
  });

  test("records which provider served the turn", () => {
    // A multi-provider chain makes the model name alone ambiguous for cost attribution.
    const totals = summarizeModelUsage({
      "gpt-5-codex": { inputTokens: 5, outputTokens: 1, provider: "codex" },
    });
    expect(totals.providers).toEqual(["codex"]);
    expect(totals.models).toEqual(["gpt-5-codex"]);
  });

  test("prefers the canonical model name when the SDK gives one", () => {
    const totals = summarizeModelUsage({
      opus: { inputTokens: 1, outputTokens: 1, provider: "claude", canonicalModel: "claude-opus-5" },
    });
    expect(totals.models).toEqual(["claude-opus-5"]);
  });

  test("de-duplicates providers across several models on one turn", () => {
    const totals = summarizeModelUsage({
      "claude-sonnet-5": { inputTokens: 1, outputTokens: 1, provider: "claude" },
      "claude-haiku-4-5": { inputTokens: 1, outputTokens: 1, provider: "claude" },
    });
    expect(totals.providers).toEqual(["claude"]);
  });

  test("string fields never leak into the numeric sums", () => {
    const totals = summarizeModelUsage({
      m: { inputTokens: 7, provider: "claude", canonicalModel: "claude-opus-5" } as Record<string, unknown>,
    });
    expect(totals.inputTokens).toBe(7);
    expect(Number.isNaN(totals.outputTokens)).toBe(false);
    expect(totals.outputTokens).toBe(0);
  });

  test("an entry with no provider is recorded without inventing one", () => {
    const totals = summarizeModelUsage({ "claude-sonnet-5": { inputTokens: 1, outputTokens: 1 } });
    expect(totals.providers).toEqual([]);
  });

  test("missing or malformed usage yields zeroes rather than throwing", () => {
    expect(summarizeModelUsage(undefined)).toMatchObject({ inputTokens: 0, models: [], providers: [] });
    expect(summarizeModelUsage("nonsense")).toMatchObject({ inputTokens: 0, models: [], providers: [] });
  });
});
