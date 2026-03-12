import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync } from "fs";
import { readPid, writePid, removePid, isRunning } from "../../src/core/daemon";

const TEST_DIR = "/tmp/test-nia-daemon";

beforeEach(() => {
  mkdirSync(`${TEST_DIR}/tmp`, { recursive: true });
  process.env.NIA_HOME = TEST_DIR;
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
  delete process.env.NIA_HOME;
});

describe("PID management", () => {
  test("writes and reads PID", () => {
    writePid(12345);
    expect(readPid()).toBe(12345);
  });

  test("returns null when no PID file", () => {
    expect(readPid()).toBeNull();
  });

  test("removes PID file", () => {
    writePid(12345);
    removePid();
    expect(readPid()).toBeNull();
  });
});

describe("isRunning", () => {
  test("returns false when no PID file", () => {
    expect(isRunning()).toBe(false);
  });

  test("returns false for stale PID and cleans up", () => {
    writePid(99999999);
    expect(isRunning()).toBe(false);
    expect(readPid()).toBeNull();
  });
});
