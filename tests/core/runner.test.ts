import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync, readFileSync } from "fs";
import { runJob } from "../../src/core/runner";
import { resetConfig } from "../../src/utils/config";
import type { JobInput } from "../../src/types";

const TEST_DIR = "/tmp/test-nia-runner";

beforeEach(() => {
  mkdirSync(`${TEST_DIR}/tmp`, { recursive: true });
  process.env.NIA_HOME = TEST_DIR;
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
  delete process.env.NIA_HOME;
  resetConfig();
});

const JOB: JobInput = {
  name: "test-echo",
  schedule: "*/5 * * * *",
  prompt: "Say hello",
};

describe("runJob", () => {
  test("executes via codex and returns result", async () => {
    writeFileSync(`${TEST_DIR}/config.yaml`, `model: codex-mini-latest\nrunner: codex\n`);
    resetConfig();

    const codexPath = Bun.which("codex");
    if (!codexPath) {
      console.log("Skipping: codex not in PATH");
      return;
    }

    const result = await runJob(JOB);

    expect(result.job).toBe("test-echo");
    expect(result.status).toBeDefined();
    expect(result.duration_ms).toBeGreaterThan(0);
    expect(result.timestamp).toBeDefined();

    const auditLines = readFileSync(`${TEST_DIR}/tmp/cron-audit.jsonl`, "utf8").trim().split("\n");
    expect(auditLines.length).toBeGreaterThanOrEqual(1);
  }, 60_000);

  test("executes via claude agent sdk and returns result", async () => {
    writeFileSync(`${TEST_DIR}/config.yaml`, `runner: claude\n`);
    resetConfig();

    if (!process.env.ANTHROPIC_API_KEY) {
      console.log("Skipping: ANTHROPIC_API_KEY not set");
      return;
    }

    const result = await runJob(JOB);

    expect(result.job).toBe("test-echo");
    expect(result.status).toBeDefined();
    expect(result.duration_ms).toBeGreaterThan(0);
    expect(result.timestamp).toBeDefined();
    expect(result.session_id).toBeDefined();

    const auditLines = readFileSync(`${TEST_DIR}/tmp/cron-audit.jsonl`, "utf8").trim().split("\n");
    expect(auditLines.length).toBeGreaterThanOrEqual(1);
  }, 120_000);
});
