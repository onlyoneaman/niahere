import { describe, expect, test } from "bun:test";
import { createProviderHealth } from "../../src/agent/health";

function fakeClock(start = 0) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe("provider health", () => {
  test("a provider is usable until it is marked down", () => {
    const h = createProviderHealth(1000, fakeClock().now);
    expect(h.isDown("claude")).toBe(false);
    h.markDown("claude");
    expect(h.isDown("claude")).toBe(true);
  });

  test("the mark expires after the cooldown", () => {
    const clock = fakeClock();
    const h = createProviderHealth(1000, clock.now);
    h.markDown("claude");
    clock.advance(999);
    expect(h.isDown("claude")).toBe(true);
    clock.advance(2);
    expect(h.isDown("claude")).toBe(false);
  });

  test("marking again re-arms the cooldown", () => {
    const clock = fakeClock();
    const h = createProviderHealth(1000, clock.now);
    h.markDown("claude");
    clock.advance(900);
    h.markDown("claude");
    clock.advance(500);
    expect(h.isDown("claude")).toBe(true);
  });

  test("providers are tracked independently", () => {
    const h = createProviderHealth(1000, fakeClock().now);
    h.markDown("claude");
    expect(h.isDown("codex")).toBe(false);
  });
});
