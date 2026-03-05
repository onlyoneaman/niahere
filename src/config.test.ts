import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { loadConfig } from "./config";

const TEST_DIR = "/tmp/test-nia-config";

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("loadConfig", () => {
  test("loads valid config from nia.yaml", () => {
    writeFileSync(
      `${TEST_DIR}/nia.yaml`,
      `model: gpt-5.3-codex-spark\nactive_hours:\n  start: "09:00"\n  end: "22:00"\n`
    );
    const config = loadConfig(TEST_DIR);
    expect(config.model).toBe("gpt-5.3-codex-spark");
    expect(config.activeHours.start).toBe("09:00");
    expect(config.activeHours.end).toBe("22:00");
  });

  test("returns defaults when no config file exists", () => {
    const config = loadConfig(TEST_DIR);
    expect(config.model).toBe("default");
    expect(config.activeHours.start).toBe("00:00");
    expect(config.activeHours.end).toBe("23:59");
  });
});
