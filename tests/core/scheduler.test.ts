import { describe, expect, spyOn, test } from "bun:test";
import { computeNextRun, computeInitialNextRun, logJobOutcome } from "../../src/core/scheduler";
import { log } from "../../src/utils/log";
import type { JobResult } from "../../src/types";

function jobResult(overrides: Partial<JobResult> = {}): JobResult {
  return {
    job: "prompt-generator",
    timestamp: "2026-07-28T03:08:40.000Z",
    status: "ok",
    result: "done",
    duration_ms: 1200,
    ...overrides,
  };
}

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

describe("logJobOutcome", () => {
  test("logs a failed job at error level", () => {
    const error = spyOn(log, "error").mockImplementation(() => {});
    const info = spyOn(log, "info").mockImplementation(() => {});
    try {
      logJobOutcome(jobResult({ status: "error", error: "OAuth session expired" }));
      expect(error).toHaveBeenCalledTimes(1);
      expect(info).not.toHaveBeenCalled();
    } finally {
      error.mockRestore();
      info.mockRestore();
    }
  });

  test("carries the failure reason so the log line is diagnosable on its own", () => {
    const error = spyOn(log, "error").mockImplementation(() => {});
    try {
      logJobOutcome(jobResult({ status: "error", error: "OAuth session expired" }));
      const [fields, msg] = error.mock.calls[0] as [Record<string, unknown>, string];
      expect(fields.job).toBe("prompt-generator");
      expect(fields.error).toBe("OAuth session expired");
      expect(msg).toContain("failed");
    } finally {
      error.mockRestore();
    }
  });

  test("logs a successful job at info level", () => {
    const error = spyOn(log, "error").mockImplementation(() => {});
    const info = spyOn(log, "info").mockImplementation(() => {});
    try {
      logJobOutcome(jobResult({ status: "ok" }));
      expect(info).toHaveBeenCalledTimes(1);
      expect(error).not.toHaveBeenCalled();
    } finally {
      error.mockRestore();
      info.mockRestore();
    }
  });
});
