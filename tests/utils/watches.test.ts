import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { resolveWatchBehavior } from "../../src/utils/watches";

const TEST_HOME = "/tmp/test-nia-watches";

beforeEach(() => {
  process.env.NIA_HOME = TEST_HOME;
  rmSync(TEST_HOME, { recursive: true, force: true });
  mkdirSync(join(TEST_HOME, "watches"), { recursive: true });
});

afterEach(() => {
  rmSync(TEST_HOME, { recursive: true, force: true });
  delete process.env.NIA_HOME;
});

describe("resolveWatchBehavior", () => {
  test("returns inline behavior when value contains whitespace", () => {
    const value = "Monitor for errors. Flag P0 to #oncall.";
    const result = resolveWatchBehavior(value);
    expect(result.behavior).toBe(value);
    expect(result.filePath).toBeNull();
  });

  test("returns inline behavior when value contains newlines", () => {
    const value = "line one\nline two";
    const result = resolveWatchBehavior(value);
    expect(result.behavior).toBe(value);
    expect(result.filePath).toBeNull();
  });

  test("loads from file when value is a bare name and file exists", () => {
    const filePath = join(TEST_HOME, "watches", "kay-monitor.md");
    const content = "You monitor Kay threads. Do X. Do Y.";
    writeFileSync(filePath, content + "\n");

    const result = resolveWatchBehavior("kay-monitor");
    expect(result.behavior).toBe(content);
    expect(result.filePath).toBe(resolve(filePath));
  });

  test("falls back to raw value if referenced file is missing", () => {
    const result = resolveWatchBehavior("nonexistent");
    expect(result.behavior).toBe("nonexistent");
    expect(result.filePath).toBeNull();
  });

  test("accepts underscores and digits in names", () => {
    const filePath = join(TEST_HOME, "watches", "ops_v2.md");
    writeFileSync(filePath, "ops behavior");

    const result = resolveWatchBehavior("ops_v2");
    expect(result.behavior).toBe("ops behavior");
    expect(result.filePath).toBe(resolve(filePath));
  });

  test("empty file falls back to raw value", () => {
    const filePath = join(TEST_HOME, "watches", "empty.md");
    writeFileSync(filePath, "   \n\n  ");

    const result = resolveWatchBehavior("empty");
    expect(result.behavior).toBe("empty");
    expect(result.filePath).toBeNull();
  });
});
