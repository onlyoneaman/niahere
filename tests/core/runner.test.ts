import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, readFileSync } from "fs";
import { runJob } from "../../src/core/runner";
import type { JobInput } from "../../src/core/runner";

const TEST_DIR = "/tmp/test-nia-runner";

beforeEach(() => {
  mkdirSync(`${TEST_DIR}/tmp`, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("runJob", () => {
  test("executes codex exec and returns result", async () => {
    const job: JobInput = {
      name: "test-echo",
      schedule: "*/5 * * * *",
      prompt: "Say hello",
    };

    // This test actually calls codex — it's an integration test.
    // If codex is not installed, skip.
    const codexPath = Bun.which("codex");
    if (!codexPath) {
      console.log("Skipping: codex not in PATH");
      return;
    }

    const result = await runJob(TEST_DIR, job, "codex-mini-latest");

    expect(result.job).toBe("test-echo");
    expect(result.status).toBeDefined();
    expect(result.duration_ms).toBeGreaterThan(0);
    expect(result.timestamp).toBeDefined();

    // Verify audit was written
    const auditLines = readFileSync(`${TEST_DIR}/tmp/cron-audit.jsonl`, "utf8").trim().split("\n");
    expect(auditLines.length).toBeGreaterThanOrEqual(1);
  }, 60_000); // 60s timeout for codex call
});
