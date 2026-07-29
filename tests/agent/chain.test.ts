import { describe, expect, test } from "bun:test";
import { ChainCursor, describeEntry, type ChainEntry } from "../../src/agent/chain";
import type { AgentBackend } from "../../src/agent/types";

const backend = (name: AgentBackend["name"]) => ({ name }) as AgentBackend;
const entry = (name: AgentBackend["name"], model?: string): ChainEntry => ({ backend: backend(name), model });

describe("ChainCursor", () => {
  test("starts at the head", () => {
    const c = new ChainCursor([entry("claude", "opus"), entry("codex")]);
    expect(describeEntry(c.current!)).toBe("claude:opus");
    expect(c.atHead).toBe(true);
  });

  test("a model-scoped failure advances one entry on the same provider", () => {
    const c = new ChainCursor([entry("claude", "opus"), entry("claude", "sonnet"), entry("codex")]);
    expect(describeEntry(c.advance("model")!)).toBe("claude:sonnet");
    expect(c.atHead).toBe(false);
  });

  test("a provider-scoped failure skips the rest of that provider", () => {
    const c = new ChainCursor([entry("claude", "opus"), entry("claude", "sonnet"), entry("codex", "gpt-5-codex")]);
    expect(describeEntry(c.advance("provider")!)).toBe("codex:gpt-5-codex");
  });

  test("a provider written off stays skipped on later advances", () => {
    const c = new ChainCursor([
      entry("claude", "opus"),
      entry("codex", "gpt-5-codex"),
      entry("claude", "sonnet"),
      entry("codex", "o3-mini"),
    ]);
    expect(describeEntry(c.advance("provider")!)).toBe("codex:gpt-5-codex");
    expect(describeEntry(c.advance("model")!)).toBe("codex:o3-mini");
  });

  test("returns undefined once nothing usable is left", () => {
    const c = new ChainCursor([entry("claude", "opus"), entry("claude", "sonnet")]);
    expect(c.advance("provider")).toBeUndefined();
  });

  test("describes a model-less entry as the provider default", () => {
    expect(describeEntry(entry("codex"))).toBe("codex:default");
  });
});
