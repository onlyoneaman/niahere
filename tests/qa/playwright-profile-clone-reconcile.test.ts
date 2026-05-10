import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from "fs";
import { homedir, tmpdir } from "os";
import { join, resolve } from "path";
import { spawnSync } from "child_process";
import { createRequire } from "module";

const RUN_BROWSER_TEST = process.env.NIA_PLAYWRIGHT_PROFILE_CLONE_RECONCILE === "1";
const maybeTest = RUN_BROWSER_TEST ? test : test.skip;

const require = createRequire(import.meta.url);
const SOURCE_PROFILE =
  process.env.NIA_PLAYWRIGHT_PRIMARY_PROFILE ||
  process.env.PW_PRIMARY_PROFILE ||
  process.env.PLAYWRIGHT_USER_PROFILE ||
  join(homedir(), ".shared", "playwright-user-profile");
const HELPER = resolve(import.meta.dir, "../../skills/qa/scripts/playwright-profile-clone.sh");

function run(command: string, args: string[], env?: Record<string, string>) {
  const result = spawnSync(command, args, {
    env: { ...process.env, ...env },
    stdio: "pipe",
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed\n${result.stderr || result.stdout}`);
  }
  return result;
}

function helper(args: string[], env: Record<string, string>) {
  return run("bash", [HELPER, ...args], env);
}

function getOutputValue(output: string, key: string): string {
  const line = output.split("\n").find((candidate) => candidate.startsWith(`${key}=`));
  if (!line) throw new Error(`Missing ${key} in output:\n${output}`);
  return line.slice(key.length + 1).replace(/^'|'$/g, "");
}

async function launchProfile(userDataDir: string) {
  const playwrightModule = process.env.PLAYWRIGHT_MODULE || "playwright";
  const { chromium } = require(playwrightModule);
  return chromium.launchPersistentContext(userDataDir, {
    channel: "chrome",
    headless: false,
    timeout: 12_000,
    ignoreDefaultArgs: ["--disable-sync"],
  });
}

describe("Playwright cloned profile runs", () => {
  maybeTest(
    "runs three copied profiles in parallel and reconciles one clone back to a primary snapshot",
    async () => {
      expect(existsSync(SOURCE_PROFILE)).toBe(true);

      const root = mkdtempSync(join(tmpdir(), "nia-pw-profile-clone-reconcile-"));
      const home = join(root, "home");
      mkdirSync(join(home, ".shared"), { recursive: true });
      writeFileSync(
        join(home, ".shared", "playwright-config.json"),
        JSON.stringify({ browser: { userDataDir: SOURCE_PROFILE } }),
      );
      const env = { HOME: home };
      const primary = join(home, ".shared", "playwright-user-profile");

      let contexts: Awaited<ReturnType<typeof launchProfile>>[] = [];

      try {
        const prepared = [helper(["prepare"], env), helper(["prepare"], env), helper(["prepare"], env)].map(
          (result) => ({
            runId: getOutputValue(result.stdout, "PW_PROFILE_RUN_ID"),
            runDir: getOutputValue(result.stdout, "PW_USER_DATA_DIR"),
          }),
        );

        contexts = await Promise.all(prepared.map((run) => launchProfile(run.runDir)));

        await Promise.all(
          contexts.map(async (context, index) => {
            const page = context.pages()[0] || (await context.newPage());
            await page.goto(`data:text/html,<title>clone-${index}</title><h1>clone-${index}</h1>`);
            expect(await page.title()).toBe(`clone-${index}`);
            writeFileSync(join(prepared[index].runDir, "nia-reconcile-marker.txt"), `clone-${index}`);
          }),
        );

        await Promise.all(contexts.map((context) => context.close()));
        contexts = [];

        helper(["commit", "--run-id", prepared[1].runId], env);
        expect(readFileSync(join(primary, "nia-reconcile-marker.txt"), "utf8")).toBe("clone-1");

        const reconciled = await launchProfile(primary);
        try {
          const page = reconciled.pages()[0] || (await reconciled.newPage());
          await page.goto("data:text/html,<title>reconciled</title>");
          expect(await page.title()).toBe("reconciled");
        } finally {
          await reconciled.close();
        }
      } finally {
        await Promise.all(contexts.map((context) => context.close().catch(() => {})));
        rmSync(root, { recursive: true, force: true });
      }
    },
    120_000,
  );
});
