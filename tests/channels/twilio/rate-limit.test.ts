import { describe, expect, test } from "bun:test";
import { RateLimiter } from "../../../src/channels/twilio/rate-limit";

describe("twilio/rate-limit", () => {
  test("allows up to the per-window cap, then denies", () => {
    const rl = new RateLimiter(3, 10_000);
    expect(rl.allow("+1")).toBe(true);
    expect(rl.allow("+1")).toBe(true);
    expect(rl.allow("+1")).toBe(true);
    expect(rl.allow("+1")).toBe(false);
    expect(rl.allow("+1")).toBe(false);
  });

  test("distinct keys have independent quotas", () => {
    const rl = new RateLimiter(2, 10_000);
    expect(rl.allow("A")).toBe(true);
    expect(rl.allow("A")).toBe(true);
    expect(rl.allow("A")).toBe(false);
    expect(rl.allow("B")).toBe(true);
    expect(rl.allow("B")).toBe(true);
    expect(rl.allow("B")).toBe(false);
  });

  test("window slides — old hits drop off and quota refills", async () => {
    const rl = new RateLimiter(2, 50);
    expect(rl.allow("x")).toBe(true);
    expect(rl.allow("x")).toBe(true);
    expect(rl.allow("x")).toBe(false);
    await new Promise((r) => setTimeout(r, 60));
    expect(rl.allow("x")).toBe(true);
  });

  test("exempt() clears tracking — owner is never blocked", () => {
    const rl = new RateLimiter(1, 60_000);
    expect(rl.allow("owner")).toBe(true);
    expect(rl.allow("owner")).toBe(false);
    rl.exempt("owner");
    expect(rl.allow("owner")).toBe(true);
  });
});
