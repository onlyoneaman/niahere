import { describe, expect, test } from "bun:test";
import { resolveModel, providerDefault, PROVIDER_ORDER } from "../../src/agent/models";

describe("resolveModel", () => {
  test("a bare provider name means that provider's own default model", () => {
    expect(resolveModel("claude")).toEqual({ provider: "claude" });
    expect(resolveModel("codex")).toEqual({ provider: "codex" });
    expect(resolveModel("gemini")).toEqual({ provider: "gemini" });
  });

  test('"default" keeps meaning Claude with no explicit model', () => {
    expect(resolveModel("default")).toEqual({ provider: "claude" });
  });

  test("Claude's short aliases resolve to Claude and stay verbatim", () => {
    for (const alias of ["sonnet", "opus", "opusplan", "haiku"]) {
      expect(resolveModel(alias)).toEqual({ provider: "claude", model: alias });
    }
  });

  test("full model ids resolve by prefix", () => {
    expect(resolveModel("claude-sonnet-5")).toEqual({ provider: "claude", model: "claude-sonnet-5" });
    expect(resolveModel("gpt-5-codex")).toEqual({ provider: "codex", model: "gpt-5-codex" });
    expect(resolveModel("o3-mini")).toEqual({ provider: "codex", model: "o3-mini" });
    expect(resolveModel("gemini-2.5-pro")).toEqual({ provider: "gemini", model: "gemini-2.5-pro" });
  });

  test("an unrecognized model is assumed to be Claude's", () => {
    expect(resolveModel("llama-3-70b")).toEqual({ provider: "claude", model: "llama-3-70b" });
  });

  test("resolution ignores case and surrounding whitespace", () => {
    expect(resolveModel("  GPT-5-Codex ")).toEqual({ provider: "codex", model: "GPT-5-Codex" });
  });
});

describe("providerDefault", () => {
  test("gives each provider an entry with no explicit model", () => {
    expect(providerDefault("codex")).toEqual({ provider: "codex" });
  });

  test("Claude leads the provider order", () => {
    expect(PROVIDER_ORDER[0]).toBe("claude");
    expect(PROVIDER_ORDER).toContain("codex");
  });
});
