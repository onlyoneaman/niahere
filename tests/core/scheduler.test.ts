import { describe, expect, test } from "bun:test";
import { computeNextRun, computeInitialNextRun } from "../../src/core/scheduler";

describe("computeNextRun", () => {
  test("computes next cron run", () => {
    const next = computeNextRun("cron", "0 9 * * *", "UTC");
    expect(next).toBeInstanceOf(Date);
    expect(next!.getUTCHours()).toBe(9);
    expect(next!.getUTCMinutes()).toBe(0);
  });

  test("computes next interval run", () => {
    const now = new Date();
    const next = computeNextRun("interval", "5m", "UTC", now);
    expect(next).toBeInstanceOf(Date);
    expect(next!.getTime()).toBe(now.getTime() + 300_000);
  });

  test("returns null for once", () => {
    const next = computeNextRun("once", "2026-03-13T18:00:00Z", "UTC");
    expect(next).toBeNull();
  });
});

describe("computeInitialNextRun", () => {
  test("computes initial cron run", () => {
    const next = computeInitialNextRun("cron", "*/5 * * * *", "UTC");
    expect(next).toBeInstanceOf(Date);
    expect(next.getTime() - Date.now()).toBeLessThanOrEqual(5 * 60 * 1000);
  });

  test("computes initial interval run", () => {
    const before = Date.now();
    const next = computeInitialNextRun("interval", "10m", "UTC");
    expect(next.getTime() - before).toBeGreaterThanOrEqual(600_000 - 100);
    expect(next.getTime() - before).toBeLessThanOrEqual(600_000 + 100);
  });

  test("parses once timestamp", () => {
    const next = computeInitialNextRun("once", "2026-12-25T00:00:00Z", "UTC");
    expect(next.toISOString()).toBe("2026-12-25T00:00:00.000Z");
  });
});
