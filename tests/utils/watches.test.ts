import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { resolveWatchBehavior } from "../../src/utils/watches";

const TEST_HOME = "/tmp/test-nia-watches";

function writeBehavior(name: string, content: string): string {
  const dir = join(TEST_HOME, "watches", name);
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, "behavior.md");
  writeFileSync(filePath, content);
  return resolve(filePath);
}

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
  test("inline prose with whitespace is passed through", () => {
    const value = "Monitor for errors. Flag P0 to #oncall.";
    const result = resolveWatchBehavior(value, "some-watch");
    expect(result.behavior).toBe(value);
    expect(result.filePath).toBeNull();
  });

  test("inline behavior with newlines is passed through", () => {
    const value = "line one\nline two";
    const result = resolveWatchBehavior(value, "some-watch");
    expect(result.behavior).toBe(value);
    expect(result.filePath).toBeNull();
  });

  test("omitted behavior loads watches/<watchName>/behavior.md", () => {
    const expectedPath = writeBehavior("kay-monitor", "Kay monitor behavior\n");

    const result = resolveWatchBehavior(undefined, "kay-monitor");
    expect(result.behavior).toBe("Kay monitor behavior");
    expect(result.filePath).toBe(expectedPath);
  });

  test("empty behavior also falls back to watchName lookup", () => {
    const expectedPath = writeBehavior("alerts", "alert behavior");

    const result = resolveWatchBehavior("", "alerts");
    expect(result.behavior).toBe("alert behavior");
    expect(result.filePath).toBe(expectedPath);
  });

  test("single-word behavior overrides watchName for file lookup", () => {
    const expectedPath = writeBehavior("shared-oncall", "shared oncall behavior");
    // Also create a file matching the watchName to prove override wins
    writeBehavior("engineering-alerts", "engineering-specific");

    const result = resolveWatchBehavior("shared-oncall", "engineering-alerts");
    expect(result.behavior).toBe("shared oncall behavior");
    expect(result.filePath).toBe(expectedPath);
  });

  test("missing file returns empty behavior (warn-only, still a valid watch)", () => {
    const result = resolveWatchBehavior(undefined, "nonexistent");
    expect(result.behavior).toBe("");
    expect(result.filePath).toBeNull();
  });

  test("empty behavior file returns empty behavior", () => {
    writeBehavior("blank", "   \n\n  ");

    const result = resolveWatchBehavior(undefined, "blank");
    expect(result.behavior).toBe("");
    expect(result.filePath).toBeNull();
  });

  test("accepts underscores and digits in names", () => {
    const expectedPath = writeBehavior("ops_v2", "ops behavior");

    const result = resolveWatchBehavior(undefined, "ops_v2");
    expect(result.behavior).toBe("ops behavior");
    expect(result.filePath).toBe(expectedPath);
  });
});
