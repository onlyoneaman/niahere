import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, readFileSync } from "fs";
import { appendAudit, readAudit, readState, writeState } from "../../src/utils/logger";
import type { AuditEntry, CronState } from "../../src/types";

const TEST_DIR = "/tmp/test-nia-logger";

beforeEach(() => {
  mkdirSync(`${TEST_DIR}/tmp`, { recursive: true });
  process.env.NIA_HOME = TEST_DIR;
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
  delete process.env.NIA_HOME;
});

describe("appendAudit", () => {
  test("appends JSONL entry to audit file", () => {
    const entry: AuditEntry = {
      job: "heartbeat",
      timestamp: "2026-03-05T12:00:00Z",
      status: "ok",
      result: "alive",
      duration_ms: 123,
    };

    appendAudit(entry);
    appendAudit({ ...entry, result: "still alive" });

    const lines = readFileSync(`${TEST_DIR}/tmp/cron-audit.jsonl`, "utf8")
      .trim()
      .split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).result).toBe("alive");
    expect(JSON.parse(lines[1]).result).toBe("still alive");
  });
});

describe("cronState", () => {
  test("reads and writes cron state", () => {
    const state: CronState = {
      heartbeat: {
        lastRun: "2026-03-05T12:00:00Z",
        status: "ok",
        duration_ms: 123,
      },
    };

    writeState(state);
    const loaded = readState();
    expect(loaded.heartbeat.status).toBe("ok");
  });

  test("returns empty object when no state file", () => {
    const state = readState();
    expect(state).toEqual({});
  });
});

describe("readAudit", () => {
  const entry = (job: string, status: "ok" | "error" = "ok"): AuditEntry => ({
    job,
    timestamp: "2026-03-05T12:00:00Z",
    status,
    result: "done",
    duration_ms: 100,
  });

  test("returns empty array when no audit file", () => {
    expect(readAudit()).toEqual([]);
  });

  test("reads all entries", () => {
    appendAudit(entry("a"));
    appendAudit(entry("b"));
    appendAudit(entry("a"));
    expect(readAudit()).toHaveLength(3);
  });

  test("filters by job name", () => {
    appendAudit(entry("a"));
    appendAudit(entry("b"));
    appendAudit(entry("a"));
    expect(readAudit("a")).toHaveLength(2);
    expect(readAudit("b")).toHaveLength(1);
    expect(readAudit("c")).toHaveLength(0);
  });

  test("limits results to last N entries", () => {
    for (let i = 0; i < 10; i++) appendAudit(entry("x"));
    expect(readAudit(undefined, 3)).toHaveLength(3);
  });
});
