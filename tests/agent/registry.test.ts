import { describe, expect, test } from "bun:test";
import { getBackend, buildChain } from "../../src/agent";

describe("getBackend", () => {
  test("returns the claude backend by default", () => {
    expect(getBackend().name).toBe("claude");
  });
  test("returns a stable singleton", () => {
    expect(getBackend()).toBe(getBackend());
  });
});

/** Chain shape as (provider:model) pairs, so assertions read like the config. */
const shape = (chain: { backend: { name: string }; model?: string }[]) =>
  chain.map((e) => `${e.backend.name}:${e.model ?? "default"}`);

describe("buildChain", () => {
  test("puts the configured model first and its fallbacks after, in order", () => {
    const chain = buildChain("claude-sonnet-5", ["gpt-5-codex"], { available: () => true });
    expect(shape(chain).slice(0, 2)).toEqual(["claude:claude-sonnet-5", "codex:gpt-5-codex"]);
  });

  test("appends an implicit entry for any provider the config never named", () => {
    const chain = buildChain("claude-sonnet-5", [], { available: () => true });
    expect(shape(chain)).toEqual(["claude:claude-sonnet-5", "codex:default"]);
  });

  test("a codex-only config still falls back to claude", () => {
    const chain = buildChain("gpt-5-codex", [], { available: () => true });
    expect(shape(chain)).toEqual(["codex:gpt-5-codex", "claude:default"]);
  });

  test("keeps several models from the same provider", () => {
    const chain = buildChain("opus", ["sonnet"], { available: () => true });
    expect(shape(chain).slice(0, 2)).toEqual(["claude:opus", "claude:sonnet"]);
  });

  test("drops implicit entries for providers that are not installed", () => {
    const chain = buildChain("claude-sonnet-5", [], { available: (p) => p === "claude" });
    expect(shape(chain)).toEqual(["claude:claude-sonnet-5"]);
  });

  test("keeps an explicitly configured model even when the provider looks unavailable", () => {
    const chain = buildChain("gpt-5-codex", [], { available: (p) => p === "claude" });
    expect(shape(chain)).toEqual(["codex:gpt-5-codex", "claude:default"]);
  });

  test("de-duplicates repeated provider:model pairs", () => {
    const chain = buildChain("sonnet", ["sonnet", "claude"], { available: () => true });
    expect(shape(chain).filter((s) => s === "claude:sonnet")).toHaveLength(1);
  });
});
