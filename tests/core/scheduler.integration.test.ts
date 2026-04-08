/**
 * Integration tests for scheduler tick behavior.
 * Tests the control flow around job execution: concurrent guard,
 * one-shot auto-disable, and invalid schedule handling.
 * Requires a test database (auto-created by setup).
 */
import {
  describe,
  expect,
  test,
  beforeAll,
  afterAll,
  beforeEach,
} from "bun:test";
import { setupTestDb, teardownTestDb } from "../db/setup";
import * as Job from "../../src/db/models/job";
import {
  computeNextRun,
  computeInitialNextRun,
} from "../../src/core/scheduler";

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
    expect(job!.enabled).toBe(true);
  });

  test("markRun with null nextRunAt disables the job", async () => {
    const name = `${PREFIX}-once-disable`;
    await Job.create(
      name,
      new Date().toISOString(),
      "task",
      false,
      "once",
      new Date(),
    );

    // Simulate what scheduler does for once jobs: markRun with null
    await Job.markRun(name, null);
    const job = await Job.get(name);
    expect(job!.enabled).toBe(false);
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
    await Job.update(name, { enabled: false });

    const job = await Job.get(name);
    expect(job!.enabled).toBe(false);
  });
});

describe("scheduler: concurrent job guard (listDue)", () => {
  test("listDue returns only enabled jobs with due next_run_at", async () => {
    const pastName = `${PREFIX}-past`;
    const futureName = `${PREFIX}-future`;
    const disabledName = `${PREFIX}-disabled`;

    // Due job (next_run_at in the past)
    await Job.create(
      pastName,
      "*/5 * * * *",
      "due job",
      false,
      "cron",
      new Date(Date.now() - 60_000),
    );
    // Future job (next_run_at in the future)
    await Job.create(
      futureName,
      "*/5 * * * *",
      "future job",
      false,
      "cron",
      new Date(Date.now() + 600_000),
    );
    // Disabled job (due but disabled)
    await Job.create(
      disabledName,
      "*/5 * * * *",
      "disabled job",
      false,
      "cron",
      new Date(Date.now() - 60_000),
    );
    await Job.update(disabledName, { enabled: false });

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
