import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { buildJobPrompt, getJobDir, resolveJobPrompt } from "../../src/core/job-prompt";
import { resetConfig } from "../../src/utils/config";
import type { JobInput } from "../../src/types";

const TEST_DIR = "/tmp/test-nia-job-prompt";

beforeEach(() => {
  process.env.NIA_HOME = TEST_DIR;
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
  delete process.env.NIA_HOME;
  resetConfig();
});

const JOB: JobInput = {
  name: "daily-brief",
  schedule: "0 9 * * *",
  prompt: "Use the database prompt.",
};

describe("resolveJobPrompt", () => {
  test("uses prompt.md from the job workspace when present", () => {
    const jobDir = join(TEST_DIR, "jobs", "daily-brief");
    mkdirSync(jobDir, { recursive: true });
    writeFileSync(join(jobDir, "prompt.md"), "\nUse the file prompt.\n");

    const resolved = resolveJobPrompt(JOB);

    expect(resolved.prompt).toBe("Use the file prompt.");
    expect(resolved.source).toBe("file");
    expect(resolved.filePath).toBe(join(jobDir, "prompt.md"));
  });

  test("falls back to database prompt when prompt.md is empty", () => {
    const jobDir = join(TEST_DIR, "jobs", "daily-brief");
    mkdirSync(jobDir, { recursive: true });
    writeFileSync(join(jobDir, "prompt.md"), "\n\n");

    const resolved = resolveJobPrompt(JOB);

    expect(resolved.prompt).toBe("Use the database prompt.");
    expect(resolved.source).toBe("database");
    expect(resolved.filePath).toBeNull();
  });

  test("falls back to default prompt when no prompt is configured", () => {
    const resolved = resolveJobPrompt({ ...JOB, prompt: "" });

    expect(resolved.prompt).toBe("Execute your scheduled tasks.");
    expect(resolved.source).toBe("default");
  });

  test("rejects job workspace paths outside jobsDir", () => {
    expect(() => getJobDir("../escape")).toThrow("Invalid job name");
  });

  test("falls back to database prompt when an existing job name has no safe workspace", () => {
    const resolved = resolveJobPrompt({ ...JOB, name: "../escape" });

    expect(resolved.prompt).toBe("Use the database prompt.");
    expect(resolved.source).toBe("database");
    expect(resolved.filePath).toBeNull();
  });
});

describe("buildJobPrompt", () => {
  test("builds the runtime prompt from the effective prompt and working memory", () => {
    const jobDir = join(TEST_DIR, "jobs", "daily-brief");
    mkdirSync(jobDir, { recursive: true });
    writeFileSync(join(jobDir, "prompt.md"), "Use the file prompt.");
    writeFileSync(join(jobDir, "state.md"), "Previous run notes.");

    const prompt = buildJobPrompt(JOB);

    expect(prompt).toContain("Job: daily-brief (schedule: 0 9 * * *)");
    expect(prompt).toContain("Use the file prompt.");
    expect(prompt).not.toContain("Use the database prompt.");
    expect(prompt).toContain("Previous run notes.");
  });
});
