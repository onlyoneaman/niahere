import { describe, expect, test } from "bun:test";
import { ChainCursor, describeEntry, type ChainEntry } from "../../src/agent/chain";
import { createProviderHealth } from "../../src/agent/health";
import type { AgentBackend } from "../../src/agent/types";

const backend = (name: AgentBackend["name"]) => ({ name }) as AgentBackend;
const entry = (name: AgentBackend["name"], model?: string): ChainEntry => ({ backend: backend(name), model });

/** Isolated health so cursors in one test cannot affect another. */
const health = () => createProviderHealth(60_000, () => 0);
const cursorFor = (entries: ChainEntry[], h = health()) => new ChainCursor(entries, h);

describe("ChainCursor", () => {
  test("starts at the head", () => {
    const c = cursorFor([entry("claude", "opus"), entry("codex")]);
    expect(describeEntry(c.current!)).toBe("claude:opus");
    expect(c.atHead).toBe(true);
  });

  test("a model-scoped failure advances one entry on the same provider", () => {
    const c = cursorFor([entry("claude", "opus"), entry("claude", "sonnet"), entry("codex")]);
    expect(describeEntry(c.advance("model")!)).toBe("claude:sonnet");
    expect(c.atHead).toBe(false);
  });

  test("a provider-scoped failure skips the rest of that provider", () => {
    const c = cursorFor([entry("claude", "opus"), entry("claude", "sonnet"), entry("codex", "gpt-5.6-sol")]);
    expect(describeEntry(c.advance("provider")!)).toBe("codex:gpt-5.6-sol");
  });

  test("a provider written off stays skipped on later advances", () => {
    const c = cursorFor([
      entry("claude", "opus"),
      entry("codex", "gpt-5.6-sol"),
      entry("claude", "sonnet"),
      entry("codex", "o3-mini"),
    ]);
    expect(describeEntry(c.advance("provider")!)).toBe("codex:gpt-5.6-sol");
    expect(describeEntry(c.advance("model")!)).toBe("codex:o3-mini");
  });

  test("returns undefined once nothing usable is left", () => {
    const c = cursorFor([entry("claude", "opus"), entry("claude", "sonnet")]);
    expect(c.advance("provider")).toBeUndefined();
  });

  test("describes a model-less entry as the provider default", () => {
    expect(describeEntry(entry("codex"))).toBe("codex:default");
  });
});

describe("ChainCursor and provider cooldown", () => {
  test("a provider-scoped failure puts that provider in cooldown", () => {
    const h = health();
    cursorFor([entry("claude", "opus"), entry("codex")], h).advance("provider");
    expect(h.isDown("claude")).toBe(true);
  });

  test("a model-scoped failure does not", () => {
    const h = health();
    cursorFor([entry("claude", "opus"), entry("claude", "sonnet")], h).advance("model");
    expect(h.isDown("claude")).toBe(false);
  });

  test("a later cursor starts past a provider still in cooldown", () => {
    const h = health();
    h.markDown("claude");
    const c = cursorFor([entry("claude", "opus"), entry("codex", "gpt-5.6-sol")], h);
    expect(describeEntry(c.current!)).toBe("codex:gpt-5.6-sol");
  });

  test("a cursor still starts at the head when every provider is cooling down", () => {
    const h = health();
    h.markDown("claude");
    h.markDown("codex");
    const c = cursorFor([entry("claude", "opus"), entry("codex")], h);
    expect(describeEntry(c.current!)).toBe("claude:opus");
  });

  test("once the cooldown lapses a new cursor is back at the head", () => {
    let t = 0;
    const h = createProviderHealth(1000, () => t);
    h.markDown("claude");
    expect(describeEntry(cursorFor([entry("claude", "opus"), entry("codex")], h).current!)).toBe("codex:default");
    t = 2000;
    expect(describeEntry(cursorFor([entry("claude", "opus"), entry("codex")], h).current!)).toBe("claude:opus");
  });
});
