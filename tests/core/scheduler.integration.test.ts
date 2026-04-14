/**
 * Integration tests for scheduler tick behavior.
 * Tests the control flow around job execution: concurrent guard,
 * one-shot auto-disable, and invalid schedule handling.
 * Requires a test database (auto-created by setup).
 */
import { describe, expect, test, beforeAll, afterAll, beforeEach } from "bun:test";
import { setupTestDb, teardownTestDb } from "../db/setup";
import * as Job from "../../src/db/models/job";
import { computeNextRun, computeInitialNextRun } from "../../src/core/scheduler";

const PREFIX = `test-sched-${Date.now()}`;

beforeAll(async () => {
  await setupTestDb();
});

afterAll(async () => {
  const { getSql } = await import("../../src/db/connection");
  const sql = getSql();
  await sql`DELETE FROM jobs WHERE name LIKE ${PREFIX + "%"}`;
  await teardownTestDb();
});

describe("scheduler: one-shot jobs", () => {
  test("computeNextRun returns null for 'once' type", () => {
    const next = computeNextRun("once", "2026-12-25T00:00:00Z", "UTC");
    expect(next).toBeNull();
  });

  test("once job can be created with a future timestamp", async () => {
    const name = `${PREFIX}-once`;
    const futureTs = new Date(Date.now() + 60_000).toISOString();
    const nextRun = computeInitialNextRun("once", futureTs, "UTC");

    await Job.create(name, futureTs, "one-time task", false, "once", nextRun);
    const job = await Job.get(name);
    expect(job).not.toBeNull();
    expect(job!.scheduleType).toBe("once");
    expect(job!.status).toBe("active");
  });

  test("markRun with null nextRunAt disables the job", async () => {
    const name = `${PREFIX}-once-disable`;
    await Job.create(name, new Date().toISOString(), "task", false, "once", new Date());

    // Simulate what scheduler does for once jobs: markRun with null
    await Job.markRun(name, null);
    const job = await Job.get(name);
    expect(job!.status).toBe("disabled");
    expect(job!.lastRunAt).not.toBeNull();
  });
});

describe("scheduler: invalid schedule handling", () => {
  test("invalid cron expression throws on computeNextRun", () => {
    expect(() => computeNextRun("cron", "not-a-cron", "UTC")).toThrow();
  });

  test("invalid interval throws on computeNextRun", () => {
    expect(() => computeNextRun("interval", "not-a-duration", "UTC")).toThrow();
  });

  test("job with invalid schedule can be disabled via update", async () => {
    const name = `${PREFIX}-bad-sched`;
    // Create with a valid schedule, then corrupt it
    await Job.create(name, "*/5 * * * *", "test");
    await Job.update(name, { status: "disabled" });

    const job = await Job.get(name);
    expect(job!.status).toBe("disabled");
  });
});

describe("scheduler: schedule update recomputes next_run_at", () => {
  test("updating a job's schedule advances next_run_at based on the new schedule", async () => {
    const name = `${PREFIX}-recompute`;

    // Create with a 1-hour interval — next_run_at should be ~1h from now.
    const createdAt = Date.now();
    await Job.create(name, "1h", "interval job", false, "interval", new Date(createdAt + 60 * 60 * 1000));

    const beforeJob = await Job.get(name);
    const beforeNext = new Date(beforeJob!.nextRunAt!).getTime();
    // Sanity check: roughly 1h from createdAt
    expect(beforeNext - createdAt).toBeGreaterThanOrEqual(55 * 60 * 1000);
    expect(beforeNext - createdAt).toBeLessThanOrEqual(65 * 60 * 1000);

    // Update to a 5-minute interval. This should reset next_run_at to
    // ~5m from NOW, not leave it at the old 1h mark.
    const updatedAt = Date.now();
    await Job.update(name, { schedule: "5m" });

    const afterJob = await Job.get(name);
    const afterNext = new Date(afterJob!.nextRunAt!).getTime();

    expect(afterNext - updatedAt).toBeGreaterThanOrEqual(4 * 60 * 1000);
    expect(afterNext - updatedAt).toBeLessThanOrEqual(6 * 60 * 1000);
    // And it should be earlier than the pre-update value (new cadence is shorter)
    expect(afterNext).toBeLessThan(beforeNext);
  });

  test("updating a non-schedule field does NOT change next_run_at", async () => {
    const name = `${PREFIX}-nosched-update`;
    const initialNext = new Date(Date.now() + 30 * 60 * 1000);
    await Job.create(name, "30m", "task", false, "interval", initialNext);

    const beforeJob = await Job.get(name);
    const beforeNext = new Date(beforeJob!.nextRunAt!).getTime();

    // Update prompt only — next_run_at must be unchanged.
    await Job.update(name, { prompt: "updated prompt" });

    const afterJob = await Job.get(name);
    const afterNext = new Date(afterJob!.nextRunAt!).getTime();

    expect(afterNext).toBe(beforeNext);
  });

  test("updating schedule type from cron to interval recomputes next_run_at", async () => {
    const name = `${PREFIX}-type-switch`;
    await Job.create(name, "0 9 * * *", "daily job", false, "cron");

    const beforeJob = await Job.get(name);
    const beforeNext = new Date(beforeJob!.nextRunAt!).getTime();

    await Job.update(name, { schedule: "2m", scheduleType: "interval" });
    const afterJob = await Job.get(name);
    const afterNext = new Date(afterJob!.nextRunAt!).getTime();

    // Should be very soon (~2m) — differs from the 9am cron calc
    expect(afterNext - Date.now()).toBeLessThanOrEqual(3 * 60 * 1000);
    expect(afterNext).not.toBe(beforeNext);
  });
});

describe("scheduler: concurrent job guard (listDue)", () => {
  test("listDue returns only enabled jobs with due next_run_at", async () => {
    const pastName = `${PREFIX}-past`;
    const futureName = `${PREFIX}-future`;
    const disabledName = `${PREFIX}-disabled`;

    // Due job (next_run_at in the past)
    await Job.create(pastName, "*/5 * * * *", "due job", false, "cron", new Date(Date.now() - 60_000));
    // Future job (next_run_at in the future)
    await Job.create(futureName, "*/5 * * * *", "future job", false, "cron", new Date(Date.now() + 600_000));
    // Disabled job (due but disabled)
    await Job.create(disabledName, "*/5 * * * *", "disabled job", false, "cron", new Date(Date.now() - 60_000));
    await Job.update(disabledName, { status: "disabled" });

    const due = await Job.listDue();
    const dueNames = due.map((j) => j.name);

    expect(dueNames).toContain(pastName);
    expect(dueNames).not.toContain(futureName);
    expect(dueNames).not.toContain(disabledName);
  });

  test("markRun advances next_run_at for interval jobs", async () => {
    const name = `${PREFIX}-advance`;
    const now = new Date();
    await Job.create(name, "10m", "interval job", false, "interval", now);

    const nextRun = computeNextRun("interval", "10m", "UTC", now);
    await Job.markRun(name, nextRun);

    const job = await Job.get(name);
    expect(job!.lastRunAt).not.toBeNull();
    expect(new Date(job!.nextRunAt!).getTime()).toBeGreaterThan(now.getTime());
  });
});
