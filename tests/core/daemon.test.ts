import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync } from "fs";
import { readPid, writePid, removePid, isRunning } from "../../src/core/daemon";

const TEST_DIR = "/tmp/test-nia-daemon";

beforeEach(() => {
  mkdirSync(`${TEST_DIR}/tmp`, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("PID management", () => {
  test("writes and reads PID", () => {
    writePid(TEST_DIR, 12345);
    expect(readPid(TEST_DIR)).toBe(12345);
  });

  test("returns null when no PID file", () => {
    expect(readPid(TEST_DIR)).toBeNull();
  });

  test("removes PID file", () => {
    writePid(TEST_DIR, 12345);
    removePid(TEST_DIR);
    expect(readPid(TEST_DIR)).toBeNull();
  });
});

describe("isRunning", () => {
  test("returns false when no PID file", () => {
    expect(isRunning(TEST_DIR)).toBe(false);
  });

  test("returns false for stale PID and cleans up", () => {
    writePid(TEST_DIR, 99999999);
    expect(isRunning(TEST_DIR)).toBe(false);
    expect(readPid(TEST_DIR)).toBeNull();
  });
});
