import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { spawnSync } from "child_process";

const SCRIPT = resolve(import.meta.dir, "../../skills/qa/scripts/playwright-profile-clone.sh");

function run(args: string[], env: Record<string, string>) {
  return spawnSync("bash", [SCRIPT, ...args], {
    env: { ...process.env, ...env },
    encoding: "utf8",
    stdio: "pipe",
  });
}

function getOutputValue(output: string, key: string): string {
  const line = output.split("\n").find((candidate) => candidate.startsWith(`${key}=`));
  if (!line) throw new Error(`Missing ${key} in output:\n${output}`);
  return line.slice(key.length + 1).replace(/^'|'$/g, "");
}

async function waitForFile(path: string): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!existsSync(path)) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${path}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

async function waitForCondition(assertion: () => boolean, label: string): Promise<void> {
  const deadline = Date.now() + 3_000;
  while (!assertion()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

describe("playwright profile clone helper", () => {
  test("prepare seeds ~/.shared/playwright-user-profile from configured profile when canonical profile is missing", () => {
    const home = mkdtempSync(join(tmpdir(), "nia-pw-helper-home-"));
    try {
      const configuredProfile = join(home, "configured-profile");
      mkdirSync(configuredProfile, { recursive: true });
      writeFileSync(join(configuredProfile, "seed.txt"), "from-config");
      mkdirSync(join(home, ".shared"), { recursive: true });
      writeFileSync(
        join(home, ".shared", "playwright-config.json"),
        JSON.stringify({ browser: { userDataDir: configuredProfile } }),
      );

      const result = run(["prepare"], { HOME: home });

      expect(result.status).toBe(0);
      const primary = join(home, ".shared", "playwright-user-profile");
      const runDir = getOutputValue(result.stdout, "PW_USER_DATA_DIR");
      const runId = getOutputValue(result.stdout, "PW_PROFILE_RUN_ID");

      expect(runId).toMatch(/^[0-9a-f]{8}$/);
      expect(readFileSync(join(primary, "seed.txt"), "utf8")).toBe("from-config");
      expect(readFileSync(join(runDir, "seed.txt"), "utf8")).toBe("from-config");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("commit reconciles a run profile back to the canonical profile and creates a backup", () => {
    const home = mkdtempSync(join(tmpdir(), "nia-pw-helper-home-"));
    try {
      const primary = join(home, ".shared", "playwright-user-profile");
      mkdirSync(primary, { recursive: true });
      writeFileSync(join(primary, "state.txt"), "before");

      const prepared = run(["prepare"], { HOME: home });
      expect(prepared.status).toBe(0);

      const runId = getOutputValue(prepared.stdout, "PW_PROFILE_RUN_ID");
      const runDir = getOutputValue(prepared.stdout, "PW_USER_DATA_DIR");
      writeFileSync(join(runDir, "state.txt"), "after");

      const committed = run(["commit", "--run-id", runId], { HOME: home });

      expect(committed.status).toBe(0);
      expect(readFileSync(join(primary, "state.txt"), "utf8")).toBe("after");
      expect(committed.stdout).toContain("status=committed");
      expect(existsSync(join(home, ".shared", "playwright-profile-backups"))).toBe(true);
      expect(existsSync(join(home, ".shared", "playwright-profile-backups", ".commit.lock"))).toBe(false);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("open launches Chrome with a cloned profile and unique CDP URL", async () => {
    const home = mkdtempSync(join(tmpdir(), "nia-pw-helper-home-"));
    const chromeArgs = join(home, "chrome-args.txt");
    const mockChrome = join(home, "mock-chrome.sh");
    try {
      const primary = join(home, ".shared", "playwright-user-profile");
      mkdirSync(primary, { recursive: true });
      writeFileSync(join(primary, "state.txt"), "ready");
      writeFileSync(
        mockChrome,
        `#!/usr/bin/env bash\nprintf '%s\\n' "$@" > "${chromeArgs}"\nsleep 60\n`,
      );
      chmodSync(mockChrome, 0o755);

      const opened = run(["open", "--keep"], { HOME: home, PLAYWRIGHT_CHROME: mockChrome });

      expect(opened.status).toBe(0);
      const runId = getOutputValue(opened.stdout, "PW_PROFILE_RUN_ID");
      const runDir = getOutputValue(opened.stdout, "PW_USER_DATA_DIR");
      const cdpUrl = getOutputValue(opened.stdout, "PW_CDP_URL");
      const pid = Number(getOutputValue(opened.stdout, "PW_CHROME_PID"));

      expect(runId).toMatch(/^[0-9a-f]{8}$/);
      expect(readFileSync(join(runDir, "state.txt"), "utf8")).toBe("ready");
      expect(cdpUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      await waitForFile(chromeArgs);
      expect(readFileSync(chromeArgs, "utf8")).toContain(`--user-data-dir=${runDir}`);
      expect(readFileSync(chromeArgs, "utf8")).toContain("--remote-debugging-port=");
      expect(getOutputValue(opened.stdout, "PW_PROFILE_CLOSE_ACTION")).toBe("keep");

      process.kill(pid, "SIGTERM");
      run(["cleanup", "--run-id", runId], { HOME: home });
      expect(existsSync(runDir)).toBe(false);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("open commits and cleans up the cloned profile when Chrome exits by default", async () => {
    const home = mkdtempSync(join(tmpdir(), "nia-pw-helper-home-"));
    const mockChrome = join(home, "mock-chrome.sh");
    try {
      const primary = join(home, ".shared", "playwright-user-profile");
      mkdirSync(primary, { recursive: true });
      writeFileSync(join(primary, "state.txt"), "before");
      writeFileSync(mockChrome, "#!/usr/bin/env bash\nsleep 60\n");
      chmodSync(mockChrome, 0o755);

      const opened = run(["open"], { HOME: home, PLAYWRIGHT_CHROME: mockChrome });

      expect(opened.status).toBe(0);
      const runDir = getOutputValue(opened.stdout, "PW_USER_DATA_DIR");
      const pid = Number(getOutputValue(opened.stdout, "PW_CHROME_PID"));
      expect(getOutputValue(opened.stdout, "PW_PROFILE_CLOSE_ACTION")).toBe("commit");

      writeFileSync(join(runDir, "state.txt"), "after-close");
      process.kill(pid, "SIGTERM");

      await waitForCondition(() => readFileSync(join(primary, "state.txt"), "utf8") === "after-close", "commit");
      await waitForCondition(() => !existsSync(runDir), "cleanup");
      expect(existsSync(join(home, ".shared", "playwright-profile-backups"))).toBe(true);
      expect(existsSync(join(home, ".shared", "playwright-profile-backups", ".commit.lock"))).toBe(false);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("prepare prunes oldest run profiles when PLAYWRIGHT_PROFILE_MAX_RUNS is exceeded", () => {
    const home = mkdtempSync(join(tmpdir(), "nia-pw-helper-home-"));
    try {
      const primary = join(home, ".shared", "playwright-user-profile");
      mkdirSync(primary, { recursive: true });
      writeFileSync(join(primary, "state.txt"), "ready");
      const env = { HOME: home, PLAYWRIGHT_PROFILE_MAX_RUNS: "2" };

      expect(run(["prepare", "--run-id", "old00001"], env).status).toBe(0);
      expect(run(["prepare", "--run-id", "old00002"], env).status).toBe(0);
      expect(run(["prepare", "--run-id", "new00003"], env).status).toBe(0);

      expect(existsSync(join(home, ".shared", "playwright-profile-runs", "old00001"))).toBe(false);
      expect(existsSync(join(home, ".shared", "playwright-profile-runs", ".state", "old00001.env"))).toBe(false);
      expect(existsSync(join(home, ".shared", "playwright-profile-runs", "old00002"))).toBe(true);
      expect(existsSync(join(home, ".shared", "playwright-profile-runs", "new00003"))).toBe(true);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("automatic run profile pruning can be disabled", () => {
    const home = mkdtempSync(join(tmpdir(), "nia-pw-helper-home-"));
    try {
      const primary = join(home, ".shared", "playwright-user-profile");
      mkdirSync(primary, { recursive: true });
      writeFileSync(join(primary, "state.txt"), "ready");
      const env = { HOME: home, PLAYWRIGHT_PROFILE_MAX_RUNS: "off" };

      expect(run(["prepare", "--run-id", "run00001"], env).status).toBe(0);
      expect(run(["prepare", "--run-id", "run00002"], env).status).toBe(0);
      expect(run(["prepare", "--run-id", "run00003"], env).status).toBe(0);

      expect(existsSync(join(home, ".shared", "playwright-profile-runs", "run00001"))).toBe(true);
      expect(existsSync(join(home, ".shared", "playwright-profile-runs", "run00002"))).toBe(true);
      expect(existsSync(join(home, ".shared", "playwright-profile-runs", "run00003"))).toBe(true);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
