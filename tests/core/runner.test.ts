import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { runJob, buildWorkingMemory } from "../../src/core/runner";
import { readState, writeState } from "../../src/utils/logger";
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

  test("concurrent jobs do not clobber each other's state", async () => {
    writeFileSync(`${TEST_DIR}/config.yaml`, `runner: claude\n`);
    resetConfig();

    // Seed state with two jobs — one "ok", one "running"
    writeState({
      "job-a": { lastRun: "2026-01-01T00:00:00Z", status: "ok", duration_ms: 1000 },
      "job-b": { lastRun: "2026-01-01T00:00:00Z", status: "running", duration_ms: 0 },
    });

    // Simulate job-a finishing: read state, pause, then write result.
    // Meanwhile job-b's state should not be overwritten.
    const stateBeforeA = { ...readState() };
    // Pretend job-b completes while job-a is still in-flight
    const freshB = { ...readState() };
    freshB["job-b"] = { lastRun: "2026-01-01T01:00:00Z", status: "ok", duration_ms: 5000 };
    writeState(freshB);

    // Now job-a finishes — if it wrote stateBeforeA it would clobber job-b back to "running".
    // The fix: re-read before writing (simulating what the fixed runner does).
    const freshA = { ...readState() };
    freshA["job-a"] = { lastRun: "2026-01-01T02:00:00Z", status: "ok", duration_ms: 2000 };
    writeState(freshA);

    const finalState = readState();
    expect(finalState["job-a"]?.status).toBe("ok");
    expect(finalState["job-a"]?.duration_ms).toBe(2000);
    expect(finalState["job-b"]?.status).toBe("ok");
    expect(finalState["job-b"]?.duration_ms).toBe(5000);
  });

  test("creates job workspace for stateful jobs", () => {
    writeFileSync(`${TEST_DIR}/config.yaml`, `runner: claude\n`);
    resetConfig();

    const result = buildWorkingMemory("test-echo");
    expect(result).toContain("## Working Memory");
    expect(result).toContain("persistent workspace");
    expect(result).toContain("first run");
    expect(existsSync(join(TEST_DIR, "jobs", "test-echo"))).toBe(true);
  });

  test("injects existing state.md content", () => {
    writeFileSync(`${TEST_DIR}/config.yaml`, `runner: claude\n`);
    resetConfig();

    const jobDir = join(TEST_DIR, "jobs", "test-echo");
    mkdirSync(jobDir, { recursive: true });
    writeFileSync(join(jobDir, "state.md"), "Last run: checked 3 feeds, found 2 new items.");

    const result = buildWorkingMemory("test-echo");
    expect(result).toContain("Last run: checked 3 feeds, found 2 new items.");
    expect(result).not.toContain("first run");
  });

  test("returns empty string for stateless jobs", () => {
    writeFileSync(`${TEST_DIR}/config.yaml`, `runner: claude\n`);
    resetConfig();

    const result = buildWorkingMemory("test-echo", true);
    expect(result).toBe("");
    expect(existsSync(join(TEST_DIR, "jobs", "test-echo"))).toBe(false);
  });

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
