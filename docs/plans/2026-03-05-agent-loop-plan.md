# niahere Agent Loop Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a minimal background daemon that runs cron-scheduled jobs via `codex exec` in Bun.js.

**Architecture:** A CLI (`niahere start/stop/status`) manages a detached daemon process. The daemon loads YAML job definitions from `jobs/`, schedules them with `node-cron`, and executes each job by shelling out to `codex exec`. All results are logged to append-only JSONL.

**Tech Stack:** Bun.js, TypeScript, node-cron, js-yaml, codex CLI

---

### Task 1: Project Scaffold

**Files:**
- Modify: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`
- Create: `niahere.yaml`
- Create: `self/identity.md`
- Create: `self/soul.md`
- Create: `jobs/heartbeat.yaml`

**Step 1: Install dependencies**

```bash
cd /Users/aman/projects/amanai/niahere
bun add node-cron js-yaml
bun add -d @types/node-cron @types/js-yaml typescript @types/bun
```

**Step 2: Update package.json**

Update `package.json` to use Bun and TypeScript:
```json
{
  "name": "niahere",
  "version": "0.1.0",
  "description": "A simple AI sidekick.",
  "type": "module",
  "scripts": {
    "start": "bun run src/cli.ts start",
    "stop": "bun run src/cli.ts stop",
    "status": "bun run src/cli.ts status",
    "dev": "bun run src/cli.ts start --foreground",
    "test": "bun test"
  },
  "keywords": ["ai", "assistant", "sidekick", "agent", "cron"],
  "author": "Aman",
  "license": "MIT",
  "private": false
}
```

**Step 3: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src",
    "types": ["bun-types"]
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist", "tmp"]
}
```

**Step 4: Create .gitignore**

```
node_modules/
dist/
tmp/
*.log
.env
bun.lockb
```

**Step 5: Create niahere.yaml**

```yaml
model: codex-mini-latest
active_hours:
  start: "00:00"
  end: "23:59"
```

**Step 6: Create self/identity.md**

```markdown
# niahere

I am niahere, a simple AI sidekick. I run as a background agent, executing scheduled tasks and keeping things running smoothly.

## Traits
- Reliable and punctual
- Concise in communication
- Focused on getting things done
```

**Step 7: Create self/soul.md**

```markdown
# Behavior Contract

1. Execute scheduled jobs on time
2. Log all actions transparently
3. Never take destructive actions without explicit permission
4. Keep responses concise and actionable
5. Report errors clearly with context
```

**Step 8: Create jobs/heartbeat.yaml**

```yaml
schedule: "*/5 * * * *"
enabled: true
prompt: |
  You are a heartbeat monitor. Write the current UTC timestamp
  and a brief status message. This is a liveness check.
```

**Step 9: Commit**

```bash
git add package.json tsconfig.json .gitignore niahere.yaml self/ jobs/
git commit -m "feat: project scaffold with deps, config, identity, and heartbeat job"
```

---

### Task 2: Paths Module

**Files:**
- Create: `src/paths.ts`
- Create: `src/paths.test.ts`

**Step 1: Write the failing test**

```ts
// src/paths.test.ts
import { describe, expect, test } from "bun:test";
import { resolve } from "path";
import { getPaths } from "./paths";

describe("getPaths", () => {
  test("returns all expected path keys", () => {
    const workspace = "/tmp/test-niahere";
    const paths = getPaths(workspace);

    expect(paths.workspace).toBe(workspace);
    expect(paths.pid).toBe(resolve(workspace, "tmp/niahere.pid"));
    expect(paths.daemonLog).toBe(resolve(workspace, "tmp/daemon.log"));
    expect(paths.cronState).toBe(resolve(workspace, "tmp/cron-state.json"));
    expect(paths.cronAudit).toBe(resolve(workspace, "tmp/cron-audit.jsonl"));
    expect(paths.config).toBe(resolve(workspace, "niahere.yaml"));
    expect(paths.jobsDir).toBe(resolve(workspace, "jobs"));
    expect(paths.selfDir).toBe(resolve(workspace, "self"));
  });
});
```

**Step 2: Run test to verify it fails**

```bash
bun test src/paths.test.ts
```
Expected: FAIL — `getPaths` not found.

**Step 3: Write minimal implementation**

```ts
// src/paths.ts
import { resolve } from "path";

export interface Paths {
  workspace: string;
  pid: string;
  daemonLog: string;
  cronState: string;
  cronAudit: string;
  config: string;
  jobsDir: string;
  selfDir: string;
}

export function getPaths(workspace: string): Paths {
  return {
    workspace,
    pid: resolve(workspace, "tmp/niahere.pid"),
    daemonLog: resolve(workspace, "tmp/daemon.log"),
    cronState: resolve(workspace, "tmp/cron-state.json"),
    cronAudit: resolve(workspace, "tmp/cron-audit.jsonl"),
    config: resolve(workspace, "niahere.yaml"),
    jobsDir: resolve(workspace, "jobs"),
    selfDir: resolve(workspace, "self"),
  };
}
```

**Step 4: Run test to verify it passes**

```bash
bun test src/paths.test.ts
```
Expected: PASS

**Step 5: Commit**

```bash
git add src/paths.ts src/paths.test.ts
git commit -m "feat: add paths module with centralized path constants"
```

---

### Task 3: Config Module

**Files:**
- Create: `src/config.ts`
- Create: `src/config.test.ts`

**Step 1: Write the failing test**

```ts
// src/config.test.ts
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { loadConfig, type Config } from "./config";

const TEST_DIR = "/tmp/test-niahere-config";

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("loadConfig", () => {
  test("loads valid config from niahere.yaml", () => {
    writeFileSync(
      `${TEST_DIR}/niahere.yaml`,
      `model: codex-mini-latest\nactive_hours:\n  start: "09:00"\n  end: "22:00"\n`
    );
    const config = loadConfig(TEST_DIR);
    expect(config.model).toBe("codex-mini-latest");
    expect(config.activeHours.start).toBe("09:00");
    expect(config.activeHours.end).toBe("22:00");
  });

  test("returns defaults when no config file exists", () => {
    const config = loadConfig(TEST_DIR);
    expect(config.model).toBe("codex-mini-latest");
    expect(config.activeHours.start).toBe("00:00");
    expect(config.activeHours.end).toBe("23:59");
  });
});
```

**Step 2: Run test to verify it fails**

```bash
bun test src/config.test.ts
```
Expected: FAIL — `loadConfig` not found.

**Step 3: Write minimal implementation**

```ts
// src/config.ts
import { existsSync, readFileSync } from "fs";
import yaml from "js-yaml";
import { getPaths } from "./paths";

export interface Config {
  model: string;
  activeHours: { start: string; end: string };
  workspace: string;
}

const DEFAULTS: Omit<Config, "workspace"> = {
  model: "codex-mini-latest",
  activeHours: { start: "00:00", end: "23:59" },
};

export function loadConfig(workspace: string): Config {
  const paths = getPaths(workspace);

  if (!existsSync(paths.config)) {
    return { ...DEFAULTS, workspace };
  }

  const raw = yaml.load(readFileSync(paths.config, "utf8")) as Record<string, unknown> | null;
  if (!raw || typeof raw !== "object") {
    return { ...DEFAULTS, workspace };
  }

  const activeHours = raw.active_hours as Record<string, string> | undefined;

  return {
    model: (raw.model as string) || DEFAULTS.model,
    activeHours: {
      start: activeHours?.start || DEFAULTS.activeHours.start,
      end: activeHours?.end || DEFAULTS.activeHours.end,
    },
    workspace,
  };
}
```

**Step 4: Run test to verify it passes**

```bash
bun test src/config.test.ts
```
Expected: PASS

**Step 5: Commit**

```bash
git add src/config.ts src/config.test.ts
git commit -m "feat: add config module with YAML loading and defaults"
```

---

### Task 4: Logger Module

**Files:**
- Create: `src/logger.ts`
- Create: `src/logger.test.ts`

**Step 1: Write the failing test**

```ts
// src/logger.test.ts
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, readFileSync } from "fs";
import { appendAudit, readState, writeState, type AuditEntry, type CronState } from "./logger";

const TEST_DIR = "/tmp/test-niahere-logger";

beforeEach(() => {
  mkdirSync(`${TEST_DIR}/tmp`, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("appendAudit", () => {
  test("appends JSONL entry to audit file", () => {
    const entry: AuditEntry = {
      job: "heartbeat",
      timestamp: "2026-03-05T12:00:00Z",
      status: "ok",
      result: "alive",
      duration_ms: 123,
    };

    appendAudit(TEST_DIR, entry);
    appendAudit(TEST_DIR, { ...entry, result: "still alive" });

    const lines = readFileSync(`${TEST_DIR}/tmp/cron-audit.jsonl`, "utf8")
      .trim()
      .split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).result).toBe("alive");
    expect(JSON.parse(lines[1]).result).toBe("still alive");
  });
});

describe("cronState", () => {
  test("reads and writes cron state", () => {
    const state: CronState = {
      heartbeat: {
        lastRun: "2026-03-05T12:00:00Z",
        status: "ok",
        duration_ms: 123,
      },
    };

    writeState(TEST_DIR, state);
    const loaded = readState(TEST_DIR);
    expect(loaded.heartbeat.status).toBe("ok");
  });

  test("returns empty object when no state file", () => {
    const state = readState(TEST_DIR);
    expect(state).toEqual({});
  });
});
```

**Step 2: Run test to verify it fails**

```bash
bun test src/logger.test.ts
```
Expected: FAIL

**Step 3: Write minimal implementation**

```ts
// src/logger.ts
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname } from "path";
import { getPaths } from "./paths";

export interface AuditEntry {
  job: string;
  timestamp: string;
  status: "ok" | "error";
  result: string;
  duration_ms: number;
  error?: string;
}

export interface JobState {
  lastRun: string;
  status: "ok" | "error" | "running";
  duration_ms: number;
  error?: string;
}

export type CronState = Record<string, JobState>;

export function appendAudit(workspace: string, entry: AuditEntry): void {
  const { cronAudit } = getPaths(workspace);
  mkdirSync(dirname(cronAudit), { recursive: true });
  appendFileSync(cronAudit, JSON.stringify(entry) + "\n");
}

export function readState(workspace: string): CronState {
  const { cronState } = getPaths(workspace);
  if (!existsSync(cronState)) return {};

  try {
    return JSON.parse(readFileSync(cronState, "utf8"));
  } catch {
    return {};
  }
}

export function writeState(workspace: string, state: CronState): void {
  const { cronState } = getPaths(workspace);
  mkdirSync(dirname(cronState), { recursive: true });
  writeFileSync(cronState, JSON.stringify(state, null, 2));
}
```

**Step 4: Run test to verify it passes**

```bash
bun test src/logger.test.ts
```
Expected: PASS

**Step 5: Commit**

```bash
git add src/logger.ts src/logger.test.ts
git commit -m "feat: add logger module with JSONL audit and cron state"
```

---

### Task 5: Cron Module (Job Parsing)

**Files:**
- Create: `src/cron.ts`
- Create: `src/cron.test.ts`

**Step 1: Write the failing test**

```ts
// src/cron.test.ts
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { parseJobs, type Job } from "./cron";

const TEST_DIR = "/tmp/test-niahere-cron";

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
```

**Step 2: Run test to verify it fails**

```bash
bun test src/cron.test.ts
```
Expected: FAIL

**Step 3: Write minimal implementation**

```ts
// src/cron.ts
import { existsSync, readdirSync, readFileSync } from "fs";
import { basename, join } from "path";
import yaml from "js-yaml";
import { getPaths } from "./paths";

export interface Job {
  name: string;
  schedule: string;
  enabled: boolean;
  prompt: string;
}

export function parseJobs(workspace: string): Job[] {
  const { jobsDir } = getPaths(workspace);
  if (!existsSync(jobsDir)) return [];

  const files = readdirSync(jobsDir).filter((f) => f.endsWith(".yaml")).sort();
  const jobs: Job[] = [];

  for (const file of files) {
    const raw = yaml.load(readFileSync(join(jobsDir, file), "utf8")) as Record<string, unknown> | null;
    if (!raw || typeof raw !== "object") continue;
    if (!raw.schedule || !raw.prompt) continue;

    jobs.push({
      name: basename(file, ".yaml"),
      schedule: String(raw.schedule),
      enabled: raw.enabled !== false,
      prompt: String(raw.prompt).trim(),
    });
  }

  return jobs;
}
```

**Step 4: Run test to verify it passes**

```bash
bun test src/cron.test.ts
```
Expected: PASS

**Step 5: Commit**

```bash
git add src/cron.ts src/cron.test.ts
git commit -m "feat: add cron module with YAML job parsing"
```

---

### Task 6: Runner Module

**Files:**
- Create: `src/runner.ts`
- Create: `src/runner.test.ts`

**Step 1: Write the failing test**

```ts
// src/runner.test.ts
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, readFileSync } from "fs";
import { runJob, type JobResult } from "./runner";
import type { Job } from "./cron";

const TEST_DIR = "/tmp/test-niahere-runner";

beforeEach(() => {
  mkdirSync(`${TEST_DIR}/tmp`, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("runJob", () => {
  test("executes codex exec and returns result", async () => {
    const job: Job = {
      name: "test-echo",
      schedule: "*/5 * * * *",
      enabled: true,
      prompt: "Say hello",
    };

    // This test actually calls codex — it's an integration test.
    // If CODEX_API_KEY is not set or codex is not installed, skip.
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
```

**Step 2: Run test to verify it fails**

```bash
bun test src/runner.test.ts
```
Expected: FAIL — `runJob` not found.

**Step 3: Write minimal implementation**

```ts
// src/runner.ts
import type { Job } from "./cron";
import { appendAudit, readState, writeState, type AuditEntry, type JobState } from "./logger";

export interface JobResult {
  job: string;
  timestamp: string;
  status: "ok" | "error";
  result: string;
  duration_ms: number;
  error?: string;
}

export async function runJob(workspace: string, job: Job, model: string): Promise<JobResult> {
  const timestamp = new Date().toISOString();
  const startMs = performance.now();

  // Update state: running
  const state = readState(workspace);
  state[job.name] = { lastRun: timestamp, status: "running", duration_ms: 0 };
  writeState(workspace, state);

  try {
    const proc = Bun.spawn(
      ["codex", "exec", job.prompt, "-m", model, "--skip-git-repo-check", "--ephemeral"],
      {
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env },
      }
    );

    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;
    const duration_ms = Math.round(performance.now() - startMs);

    const ok = exitCode === 0;
    const result: JobResult = {
      job: job.name,
      timestamp,
      status: ok ? "ok" : "error",
      result: stdout.trim(),
      duration_ms,
      error: ok ? undefined : stderr.trim() || `exit code ${exitCode}`,
    };

    // Log audit
    const auditEntry: AuditEntry = {
      job: result.job,
      timestamp: result.timestamp,
      status: result.status,
      result: result.result.slice(0, 2000),
      duration_ms: result.duration_ms,
      error: result.error,
    };
    appendAudit(workspace, auditEntry);

    // Update state
    state[job.name] = {
      lastRun: timestamp,
      status: result.status,
      duration_ms: result.duration_ms,
      error: result.error,
    };
    writeState(workspace, state);

    return result;
  } catch (err) {
    const duration_ms = Math.round(performance.now() - startMs);
    const errorMsg = err instanceof Error ? err.message : String(err);

    const result: JobResult = {
      job: job.name,
      timestamp,
      status: "error",
      result: "",
      duration_ms,
      error: errorMsg,
    };

    appendAudit(workspace, {
      job: result.job,
      timestamp: result.timestamp,
      status: "error",
      result: "",
      duration_ms,
      error: errorMsg,
    });

    state[job.name] = {
      lastRun: timestamp,
      status: "error",
      duration_ms,
      error: errorMsg,
    };
    writeState(workspace, state);

    return result;
  }
}
```

**Step 4: Run test to verify it passes**

```bash
bun test src/runner.test.ts --timeout 60000
```
Expected: PASS (or skip if codex not available)

**Step 5: Commit**

```bash
git add src/runner.ts src/runner.test.ts
git commit -m "feat: add runner module — executes jobs via codex exec"
```

---

### Task 7: Daemon Module

**Files:**
- Create: `src/daemon.ts`
- Create: `src/daemon.test.ts`

**Step 1: Write the failing test**

```ts
// src/daemon.test.ts
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from "fs";
import { readPid, writePid, removePid, isRunning } from "./daemon";

const TEST_DIR = "/tmp/test-niahere-daemon";

beforeEach(() => {
  mkdirSync(`${TEST_DIR}/tmp`, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("PID management", () => {
  test("writes and reads PID", () => {
    writePid(TEST_DIR, 12345);
    expect(readPid(TEST_DIR)).toBe(12345);
  });

  test("returns null when no PID file", () => {
    expect(readPid(TEST_DIR)).toBeNull();
  });

  test("removes PID file", () => {
    writePid(TEST_DIR, 12345);
    removePid(TEST_DIR);
    expect(readPid(TEST_DIR)).toBeNull();
  });
});

describe("isRunning", () => {
  test("returns false when no PID file", () => {
    expect(isRunning(TEST_DIR)).toBe(false);
  });

  test("returns false for stale PID and cleans up", () => {
    // Use a PID that's almost certainly not running
    writePid(TEST_DIR, 99999999);
    expect(isRunning(TEST_DIR)).toBe(false);
    // Stale PID file should be cleaned
    expect(readPid(TEST_DIR)).toBeNull();
  });
});
```

**Step 2: Run test to verify it fails**

```bash
bun test src/daemon.test.ts
```
Expected: FAIL

**Step 3: Write minimal implementation**

```ts
// src/daemon.ts
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { dirname } from "path";
import cron from "node-cron";
import { getPaths } from "./paths";
import { loadConfig } from "./config";
import { parseJobs } from "./cron";
import { runJob } from "./runner";

export function writePid(workspace: string, pid: number): void {
  const { pid: pidPath } = getPaths(workspace);
  mkdirSync(dirname(pidPath), { recursive: true });
  writeFileSync(pidPath, String(pid));
}

export function readPid(workspace: string): number | null {
  const { pid: pidPath } = getPaths(workspace);
  if (!existsSync(pidPath)) return null;

  try {
    return parseInt(readFileSync(pidPath, "utf8").trim(), 10);
  } catch {
    return null;
  }
}

export function removePid(workspace: string): void {
  const { pid: pidPath } = getPaths(workspace);
  try {
    unlinkSync(pidPath);
  } catch {
    // Already gone
  }
}

export function isRunning(workspace: string): boolean {
  const pid = readPid(workspace);
  if (pid === null) return false;

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    // Process not found — stale PID
    removePid(workspace);
    return false;
  }
}

export function startDaemon(workspace: string): number {
  const proc = Bun.spawn(["bun", "run", "src/cli.ts", "run"], {
    cwd: workspace,
    stdio: ["ignore", "ignore", "ignore"],
    env: { ...process.env },
  });

  // Unref so parent can exit
  proc.unref();
  const pid = proc.pid;
  writePid(workspace, pid);
  return pid;
}

export function stopDaemon(workspace: string): boolean {
  const pid = readPid(workspace);
  if (pid === null) return false;

  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // Already dead
  }

  removePid(workspace);
  return true;
}

export async function runDaemon(workspace: string): Promise<void> {
  const config = loadConfig(workspace);
  const jobs = parseJobs(workspace).filter((j) => j.enabled);

  writePid(workspace, process.pid);

  console.log(`[niahere] daemon started (pid: ${process.pid}, jobs: ${jobs.length})`);

  const shutdown = () => {
    console.log("[niahere] shutting down...");
    removePid(workspace);
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  for (const job of jobs) {
    console.log(`[niahere] scheduling "${job.name}" → ${job.schedule}`);
    cron.schedule(job.schedule, async () => {
      console.log(`[niahere] running job: ${job.name}`);
      const result = await runJob(workspace, job, config.model);
      console.log(`[niahere] job "${job.name}" ${result.status} (${result.duration_ms}ms)`);
    });
  }

  // Keep process alive
  await new Promise(() => {});
}
```

**Step 4: Run test to verify it passes**

```bash
bun test src/daemon.test.ts
```
Expected: PASS

**Step 5: Commit**

```bash
git add src/daemon.ts src/daemon.test.ts
git commit -m "feat: add daemon module — PID management, start/stop, cron scheduling"
```

---

### Task 8: CLI Entry Point

**Files:**
- Create: `src/cli.ts`

**Step 1: Write the CLI**

```ts
// src/cli.ts
import { resolve } from "path";
import { isRunning, readPid, runDaemon, startDaemon, stopDaemon } from "./daemon";
import { readState } from "./logger";

const workspace = resolve(import.meta.dir, "..");
const command = process.argv[2];

switch (command) {
  case "start": {
    if (isRunning(workspace)) {
      const pid = readPid(workspace);
      console.log(`niahere is already running (pid: ${pid})`);
      process.exit(1);
    }
    const pid = startDaemon(workspace);
    console.log(`niahere started (pid: ${pid})`);
    break;
  }

  case "stop": {
    if (!isRunning(workspace)) {
      console.log("niahere is not running");
      process.exit(1);
    }
    stopDaemon(workspace);
    console.log("niahere stopped");
    break;
  }

  case "status": {
    const running = isRunning(workspace);
    const pid = readPid(workspace);
    console.log(`niahere: ${running ? `running (pid: ${pid})` : "stopped"}`);

    const state = readState(workspace);
    const entries = Object.entries(state);
    if (entries.length > 0) {
      console.log("\nJobs:");
      for (const [name, info] of entries) {
        console.log(`  ${name}: ${info.status} (last: ${info.lastRun}, ${info.duration_ms}ms)`);
      }
    }
    break;
  }

  case "run": {
    // Foreground mode — used by daemon's child process
    await runDaemon(workspace);
    break;
  }

  default:
    console.log("Usage: niahere <start|stop|status>");
    process.exit(1);
}
```

**Step 2: Test it manually**

```bash
bun run src/cli.ts status
```
Expected: `niahere: stopped`

**Step 3: Commit**

```bash
git add src/cli.ts
git commit -m "feat: add CLI entry point — start, stop, status, run commands"
```

---

### Task 9: End-to-End Smoke Test

**Step 1: Run status**

```bash
bun run status
```
Expected: `niahere: stopped`

**Step 2: Start the daemon**

```bash
bun run start
```
Expected: `niahere started (pid: <number>)`

**Step 3: Check status**

```bash
bun run status
```
Expected: `niahere: running (pid: <number>)`

**Step 4: Wait for heartbeat to fire (or check logs)**

```bash
# After 5 minutes, or check the daemon log:
cat tmp/daemon.log 2>/dev/null
cat tmp/cron-audit.jsonl 2>/dev/null
```

**Step 5: Stop the daemon**

```bash
bun run stop
```
Expected: `niahere stopped`

**Step 6: Verify stopped**

```bash
bun run status
```
Expected: `niahere: stopped`

**Step 7: Run all tests**

```bash
bun test
```
Expected: All tests pass.

**Step 8: Commit any fixes from smoke testing**

```bash
git add -A
git commit -m "test: end-to-end smoke test verified"
```
