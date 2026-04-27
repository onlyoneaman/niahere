import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import {
  clearForceShutdownRequest,
  consumeForceShutdownRequest,
  requestForceShutdown,
} from "../../src/core/force-shutdown";

const TEST_DIR = "/tmp/test-nia-force-shutdown";

beforeEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
  mkdirSync(join(TEST_DIR, "tmp"), { recursive: true });
  process.env.NIA_HOME = TEST_DIR;
});

afterEach(() => {
  clearForceShutdownRequest();
  rmSync(TEST_DIR, { recursive: true, force: true });
  delete process.env.NIA_HOME;
});

describe("force shutdown marker", () => {
  test("targeted marker applies only to matching pid", () => {
    requestForceShutdown([123]);

    expect(consumeForceShutdownRequest(456)).toBe(false);
    expect(consumeForceShutdownRequest(123)).toBe(true);
    expect(existsSync(join(TEST_DIR, "tmp", "force-shutdown.json"))).toBe(false);
  });

  test("empty pid list applies to any daemon", () => {
    requestForceShutdown([]);

    expect(consumeForceShutdownRequest(999)).toBe(true);
  });

  test("clearForceShutdownRequest removes marker", () => {
    requestForceShutdown([123]);
    clearForceShutdownRequest();

    expect(consumeForceShutdownRequest(123)).toBe(false);
  });
});
