import { describe, expect, test, afterEach } from "bun:test";
import { resolve } from "path";
import { getPaths } from "../../src/utils/paths";

const TEST_DIR = "/tmp/test-nia-paths";

afterEach(() => {
  delete process.env.NIA_HOME;
});

describe("getPaths", () => {
  test("returns all expected path keys", () => {
    process.env.NIA_HOME = TEST_DIR;
    const paths = getPaths();

    expect(paths.home).toBe(TEST_DIR);
    expect(paths.pid).toBe(resolve(TEST_DIR, "tmp/nia.pid"));
    expect(paths.daemonLog).toBe(resolve(TEST_DIR, "tmp/daemon.log"));
    expect(paths.cronState).toBe(resolve(TEST_DIR, "tmp/cron-state.json"));
    expect(paths.cronAudit).toBe(resolve(TEST_DIR, "tmp/cron-audit.jsonl"));
    expect(paths.config).toBe(resolve(TEST_DIR, "config.yaml"));
    expect(paths.jobsDir).toBe(resolve(TEST_DIR, "jobs"));
    expect(paths.selfDir).toBe(resolve(TEST_DIR, "self"));
    expect(paths.beadsDir).toBe(resolve(TEST_DIR, "beads"));
    expect(paths.skillsDir).toBe(resolve(TEST_DIR, "skills"));
  });
});
