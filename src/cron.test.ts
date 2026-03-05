import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { parseJobs } from "./cron";

const TEST_DIR = "/tmp/test-nia-cron";

beforeEach(() => {
  mkdirSync(`${TEST_DIR}/jobs`, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("parseJobs", () => {
  test("parses valid YAML job files", () => {
    writeFileSync(
      `${TEST_DIR}/jobs/heartbeat.yaml`,
      `schedule: "*/5 * * * *"\nenabled: true\nprompt: |\n  Check heartbeat.\n`
    );
    const jobs = parseJobs(TEST_DIR);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].name).toBe("heartbeat");
    expect(jobs[0].schedule).toBe("*/5 * * * *");
    expect(jobs[0].enabled).toBe(true);
    expect(jobs[0].prompt).toContain("Check heartbeat.");
  });

  test("skips disabled jobs", () => {
    writeFileSync(
      `${TEST_DIR}/jobs/disabled.yaml`,
      `schedule: "0 * * * *"\nenabled: false\nprompt: skip me\n`
    );
    const jobs = parseJobs(TEST_DIR);
    const enabled = jobs.filter((j) => j.enabled);
    expect(enabled).toHaveLength(0);
  });

  test("skips files missing required fields", () => {
    writeFileSync(`${TEST_DIR}/jobs/bad.yaml`, `foo: bar\n`);
    const jobs = parseJobs(TEST_DIR);
    expect(jobs).toHaveLength(0);
  });

  test("returns empty array when jobs dir missing", () => {
    rmSync(`${TEST_DIR}/jobs`, { recursive: true, force: true });
    const jobs = parseJobs(TEST_DIR);
    expect(jobs).toEqual([]);
  });
});
