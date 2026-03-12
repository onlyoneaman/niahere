import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, readFileSync } from "fs";
import { appendAudit, readState, writeState, type AuditEntry, type CronState } from "../../src/utils/logger";

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
