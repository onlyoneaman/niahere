# Employee System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a first-class "employee" entity to niahere — persistent, goal-driven autonomous principals that can be onboarded to projects and operate via `nia chat --employee <name>`.

**Architecture:** Employees are file-based entities in `~/.niahere/employees/<name>/` with YAML-frontmatter EMPLOYEE.md files. A scanner discovers them (mirroring the agent scanner pattern). The chat engine and REPL are extended to accept `--employee` which swaps the system prompt to the employee's identity + state. CLI commands manage the lifecycle.

**Tech Stack:** TypeScript, Bun, js-yaml, existing niahere patterns (scanner, CLI, chat engine)

---

### Task 1: Employee Type Definition

**Files:**

- Create: `src/types/employee.ts`

- [ ] **Step 1: Create the EmployeeInfo interface**

```typescript
// src/types/employee.ts
export interface EmployeeInfo {
  name: string;
  project: string;
  repo: string;
  role: string;
  model?: string;
  status: "onboarding" | "active" | "paused";
  maxSubEmployees: number;
  body: string;
  created: string;
  parent?: string;
  source: string;
}
```

- [ ] **Step 2: Export from types barrel**

In `src/types/index.ts`, add:

```typescript
export type { EmployeeInfo } from "./employee";
```

- [ ] **Step 3: Add employeesDir to Paths**

In `src/types/paths.ts`, add `employeesDir: string` to the `Paths` interface.

In `src/utils/paths.ts`, add to the returned object:

```typescript
employeesDir: resolve(home, "employees"),
```

- [ ] **Step 4: Commit**

```bash
git add src/types/employee.ts src/types/index.ts src/types/paths.ts src/utils/paths.ts
git commit -m "feat(employee): add EmployeeInfo type and employeesDir path"
```

---

### Task 2: Employee Scanner

**Files:**

- Create: `src/core/employees.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/core/employees.test.ts`:

```typescript
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { scanEmployees, getEmployee } from "../../src/core/employees";
import { resetConfig } from "../../src/utils/config";

const TEST_DIR = "/tmp/test-nia-employees";

function niaEmployees() {
  return scanEmployees().filter((e) => e.source === "nia");
}

beforeEach(() => {
  mkdirSync(`${TEST_DIR}/employees/james`, { recursive: true });
  mkdirSync(`${TEST_DIR}/tmp`, { recursive: true });
  process.env.NIA_HOME = TEST_DIR;
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
  delete process.env.NIA_HOME;
  resetConfig();
});

describe("scanEmployees", () => {
  test("discovers EMPLOYEE.md files with frontmatter", () => {
    writeFileSync(
      `${TEST_DIR}/employees/james/EMPLOYEE.md`,
      `---\nname: james\nproject: aicodeusage.com\nrepo: /tmp/aicodeusage\nrole: Chief of Staff\nmodel: opus\nstatus: active\nmaxSubEmployees: 3\ncreated: 2026-04-12\n---\n\nYou are James.`,
    );
    const employees = niaEmployees();
    expect(employees).toHaveLength(1);
    expect(employees[0].name).toBe("james");
    expect(employees[0].project).toBe("aicodeusage.com");
    expect(employees[0].repo).toBe("/tmp/aicodeusage");
    expect(employees[0].role).toBe("Chief of Staff");
    expect(employees[0].model).toBe("opus");
    expect(employees[0].status).toBe("active");
    expect(employees[0].maxSubEmployees).toBe(3);
    expect(employees[0].body).toBe("You are James.");
  });

  test("skips directories without EMPLOYEE.md", () => {
    mkdirSync(`${TEST_DIR}/employees/empty`, { recursive: true });
    const employees = niaEmployees();
    expect(employees).toHaveLength(0);
  });

  test("skips files with invalid frontmatter", () => {
    writeFileSync(`${TEST_DIR}/employees/james/EMPLOYEE.md`, "no frontmatter here");
    const employees = niaEmployees();
    expect(employees).toHaveLength(0);
  });
});

describe("getEmployee", () => {
  test("returns employee by name", () => {
    writeFileSync(
      `${TEST_DIR}/employees/james/EMPLOYEE.md`,
      `---\nname: james\nproject: test\nrepo: /tmp/test\nrole: Dev\nstatus: active\nmaxSubEmployees: 3\ncreated: 2026-04-12\n---\n\nBody.`,
    );
    const emp = getEmployee("james");
    expect(emp).toBeDefined();
    expect(emp!.name).toBe("james");
  });

  test("returns undefined for unknown employee", () => {
    const emp = getEmployee("nobody");
    expect(emp).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/core/employees.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the employee scanner**

Create `src/core/employees.ts`:

```typescript
import { existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import yaml from "js-yaml";
import { getNiaHome } from "../utils/paths";
import { log } from "../utils/log";
import type { EmployeeInfo } from "../types/employee";

function getEmployeesDir(): string {
  return join(getNiaHome(), "employees");
}

export function scanEmployees(): EmployeeInfo[] {
  const employees: EmployeeInfo[] = [];
  const dir = getEmployeesDir();
  if (!existsSync(dir)) return employees;

  const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;

    const empFile = join(dir, entry.name, "EMPLOYEE.md");
    if (!existsSync(empFile)) continue;

    const content = readFileSync(empFile, "utf8");
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!fmMatch) continue;

    let meta: Record<string, unknown> = {};
    try {
      meta = (yaml.load(fmMatch[1]) as Record<string, unknown>) || {};
    } catch (err) {
      log.warn({ err, employee: entry.name, path: empFile }, "failed to parse employee metadata, skipping");
      continue;
    }

    const name = (typeof meta.name === "string" ? meta.name : "") || entry.name;
    const body = content.replace(/^---\n[\s\S]*?\n---\n*/, "").trim();

    employees.push({
      name,
      project: typeof meta.project === "string" ? meta.project : "",
      repo: typeof meta.repo === "string" ? meta.repo : "",
      role: typeof meta.role === "string" ? meta.role : "Employee",
      model: typeof meta.model === "string" ? meta.model : undefined,
      status:
        meta.status === "onboarding" || meta.status === "active" || meta.status === "paused"
          ? meta.status
          : "onboarding",
      maxSubEmployees: typeof meta.maxSubEmployees === "number" ? meta.maxSubEmployees : 3,
      body,
      created: typeof meta.created === "string" ? meta.created : new Date().toISOString().slice(0, 10),
      parent: typeof meta.parent === "string" ? meta.parent : undefined,
      source: "nia",
    });
  }

  return employees;
}

export function getEmployee(name: string): EmployeeInfo | undefined {
  return scanEmployees().find((e) => e.name.toLowerCase() === name.toLowerCase());
}

export function getEmployeeDir(name: string): string {
  return join(getEmployeesDir(), name);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/core/employees.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/employees.ts tests/core/employees.test.ts
git commit -m "feat(employee): add employee scanner with tests"
```

---

### Task 3: Employee System Prompt Builder

**Files:**

- Create: `src/chat/employee-prompt.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/chat/employee-prompt.test.ts`:

```typescript
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { buildEmployeePrompt } from "../../src/chat/employee-prompt";
import { resetConfig } from "../../src/utils/config";

const TEST_DIR = "/tmp/test-nia-emp-prompt";

beforeEach(() => {
  mkdirSync(`${TEST_DIR}/employees/james/onboarding`, { recursive: true });
  mkdirSync(`${TEST_DIR}/tmp`, { recursive: true });
  process.env.NIA_HOME = TEST_DIR;
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
  delete process.env.NIA_HOME;
  resetConfig();
});

describe("buildEmployeePrompt", () => {
  test("builds prompt from employee body and state files", () => {
    writeFileSync(
      `${TEST_DIR}/employees/james/EMPLOYEE.md`,
      `---\nname: james\nproject: test\nrepo: /tmp/test\nrole: Chief of Staff\nstatus: active\nmaxSubEmployees: 3\ncreated: 2026-04-12\n---\n\nYou are James.`,
    );
    writeFileSync(`${TEST_DIR}/employees/james/goals.md`, "# Goals\n- Grow the project");
    writeFileSync(`${TEST_DIR}/employees/james/memory.md`, "# Memory\n- Learned X");

    const prompt = buildEmployeePrompt("james");
    expect(prompt).toContain("You are James.");
    expect(prompt).toContain("Grow the project");
    expect(prompt).toContain("Learned X");
  });

  test("includes onboarding context if present", () => {
    writeFileSync(
      `${TEST_DIR}/employees/james/EMPLOYEE.md`,
      `---\nname: james\nproject: test\nrepo: /tmp/test\nrole: Dev\nstatus: active\nmaxSubEmployees: 3\ncreated: 2026-04-12\n---\n\nYou are James.`,
    );
    writeFileSync(`${TEST_DIR}/employees/james/onboarding/brief.md`, "The project does X.");
    writeFileSync(`${TEST_DIR}/employees/james/onboarding/discovery.md`, "Found Y in repo.");

    const prompt = buildEmployeePrompt("james");
    expect(prompt).toContain("The project does X.");
    expect(prompt).toContain("Found Y in repo.");
  });

  test("returns empty string for unknown employee", () => {
    const prompt = buildEmployeePrompt("nobody");
    expect(prompt).toBe("");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/chat/employee-prompt.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the employee prompt builder**

Create `src/chat/employee-prompt.ts`:

```typescript
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { getEmployee, getEmployeeDir } from "../core/employees";
import { getEnvironmentPrompt } from "../prompts";

function loadFile(dir: string, name: string): string {
  const filePath = join(dir, name);
  if (!existsSync(filePath)) return "";
  return readFileSync(filePath, "utf8").trim();
}

export function buildEmployeePrompt(name: string): string {
  const employee = getEmployee(name);
  if (!employee) return "";

  const dir = getEmployeeDir(name);
  const parts: string[] = [];

  // Core identity (the EMPLOYEE.md body)
  if (employee.body) parts.push(employee.body);

  // Environment info
  parts.push(getEnvironmentPrompt());

  // Employee metadata context
  parts.push(`## Your Profile
- **Name:** ${employee.name}
- **Role:** ${employee.role}
- **Project:** ${employee.project}
- **Repo:** ${employee.repo}
- **Status:** ${employee.status}
- **Max Sub-Employees:** ${employee.maxSubEmployees}`);

  // State files
  const goals = loadFile(dir, "goals.md");
  if (goals) parts.push(`## Your Current Goals\n${goals}`);

  const memory = loadFile(dir, "memory.md");
  if (memory) parts.push(`## Your Memory\n${memory}`);

  const decisions = loadFile(dir, "decisions.md");
  if (decisions) parts.push(`## Decision Log\n${decisions}`);

  const org = loadFile(dir, "org.md");
  if (org) parts.push(`## Your Organization\n${org}`);

  // Onboarding context
  const brief = loadFile(join(dir, "onboarding"), "brief.md");
  if (brief) parts.push(`## Onboarding Brief\n${brief}`);

  const discovery = loadFile(join(dir, "onboarding"), "discovery.md");
  if (discovery) parts.push(`## Self-Discovery Notes\n${discovery}`);

  const plan = loadFile(join(dir, "onboarding"), "plan.md");
  if (plan) parts.push(`## Initial Plan\n${plan}`);

  return parts.join("\n\n");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/chat/employee-prompt.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/chat/employee-prompt.ts tests/chat/employee-prompt.test.ts
git commit -m "feat(employee): add employee system prompt builder with tests"
```

---

### Task 4: Employee CLI — list, show, pause, resume, remove

**Files:**

- Create: `src/cli/employee.ts`

- [ ] **Step 1: Create the employee CLI module**

```typescript
// src/cli/employee.ts
import { existsSync, readFileSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import yaml from "js-yaml";
import { scanEmployees, getEmployee, getEmployeeDir } from "../core/employees";
import { fail, DIM, RESET } from "../utils/cli";
import { getNiaHome } from "../utils/paths";

const HELP = `Usage: nia employee <command>

Commands:
  list                    List all employees
  show <name>             Show employee details and state
  add <name>              Create employee and start onboarding
    --project <label>     Project name (required)
    --repo <path>         Project repo path (required)
    --role <role>         Role title (default: "Chief of Staff")
    --model <model>       Model override
    --max-sub-employees <n>  Max sub-employees (default: 3)
  pause <name>            Pause an employee
  resume <name>           Resume a paused employee
  remove <name>           Remove an employee
  approvals [name]        Show pending approvals`;

export async function employeeCommand(): Promise<void> {
  const subcommand = process.argv[3];

  if (subcommand === "--help" || subcommand === "-h" || subcommand === "help") {
    console.log(HELP);
    return;
  }

  switch (subcommand) {
    case "list": {
      const employees = scanEmployees();
      if (employees.length === 0) {
        console.log("No employees. Create one with: nia employee add <name> --project <project> --repo <path>");
      } else {
        for (const e of employees) {
          const model = e.model ? ` (${e.model})` : "";
          const parent = e.parent ? ` → ${e.parent}` : "";
          console.log(`  ${e.name}${model}  [${e.status}]${parent}`);
          console.log(`    ${e.role} — ${e.project}`);
        }
      }
      break;
    }

    case "show": {
      const name = process.argv[4];
      if (!name) fail("Usage: nia employee show <name>");
      const emp = getEmployee(name);
      if (!emp) fail(`Employee "${name}" not found.`);
      console.log(`Name:        ${emp.name}`);
      console.log(`Role:        ${emp.role}`);
      console.log(`Project:     ${emp.project}`);
      console.log(`Repo:        ${emp.repo}`);
      console.log(`Status:      ${emp.status}`);
      console.log(`Model:       ${emp.model || "(default)"}`);
      console.log(`Created:     ${emp.created}`);
      if (emp.parent) console.log(`Parent:      ${emp.parent}`);
      console.log(`Max Subs:    ${emp.maxSubEmployees}`);

      // Show state file summaries
      const dir = getEmployeeDir(name);
      const goals = loadFilePreview(join(dir, "goals.md"));
      if (goals) console.log(`\n--- Goals ---\n${goals}`);
      const decisions = loadFilePendingCount(join(dir, "decisions.md"));
      if (decisions > 0) console.log(`\nPending approvals: ${decisions}`);
      break;
    }

    case "pause": {
      const name = process.argv[4];
      if (!name) fail("Usage: nia employee pause <name>");
      updateStatus(name, "paused");
      console.log(`${name} paused.`);
      break;
    }

    case "resume": {
      const name = process.argv[4];
      if (!name) fail("Usage: nia employee resume <name>");
      updateStatus(name, "active");
      console.log(`${name} resumed.`);
      break;
    }

    case "remove": {
      const name = process.argv[4];
      if (!name) fail("Usage: nia employee remove <name>");
      const emp = getEmployee(name);
      if (!emp) fail(`Employee "${name}" not found.`);
      const dir = getEmployeeDir(name);
      rmSync(dir, { recursive: true, force: true });
      console.log(`${name} removed.`);
      break;
    }

    case "approvals": {
      const name = process.argv[4];
      const employees = name ? [getEmployee(name)].filter(Boolean) : scanEmployees();
      if (employees.length === 0) {
        console.log(name ? `Employee "${name}" not found.` : "No employees.");
        return;
      }
      let found = false;
      for (const emp of employees) {
        if (!emp) continue;
        const dir = getEmployeeDir(emp.name);
        const decisionsFile = join(dir, "decisions.md");
        if (!existsSync(decisionsFile)) continue;
        const content = readFileSync(decisionsFile, "utf8");
        const pending = content.split(/^## /m).filter((s) => s.includes("[pending]"));
        if (pending.length > 0) {
          found = true;
          console.log(`\n${DIM}${emp.name}:${RESET}`);
          for (const p of pending) {
            console.log(`  ${p.trim().split("\n")[0]}`);
          }
        }
      }
      if (!found) console.log("No pending approvals.");
      break;
    }

    case "add": {
      // Handled separately — needs interactive onboarding
      const { employeeAdd } = await import("./employee-add");
      await employeeAdd();
      break;
    }

    default:
      if (subcommand) console.error(`Unknown subcommand: ${subcommand}`);
      console.log(HELP);
      process.exit(subcommand ? 1 : 0);
  }
}

function updateStatus(name: string, status: "active" | "paused"): void {
  const emp = getEmployee(name);
  if (!emp) fail(`Employee "${name}" not found.`);
  const dir = getEmployeeDir(name);
  const empFile = join(dir, "EMPLOYEE.md");
  let content = readFileSync(empFile, "utf8");
  content = content.replace(/^(status:\s*).+$/m, `$1${status}`);
  writeFileSync(empFile, content);
}

function loadFilePreview(path: string): string {
  if (!existsSync(path)) return "";
  const content = readFileSync(path, "utf8").trim();
  const lines = content.split("\n").slice(0, 10);
  return lines.join("\n");
}

function loadFilePendingCount(path: string): number {
  if (!existsSync(path)) return 0;
  const content = readFileSync(path, "utf8");
  return (content.match(/\[pending\]/g) || []).length;
}
```

- [ ] **Step 2: Register in CLI index**

In `src/cli/index.ts`, add the import:

```typescript
import { employeeCommand } from "./employee";
```

Add the case in the switch statement (after the `agent` case):

```typescript
  case "employee": {
    await employeeCommand();
    break;
  }
```

Add to the HELP string under the "Persona" section:

```
  employee <sub>                  Manage employees
```

- [ ] **Step 3: Verify it runs**

Run: `bun run src/cli/index.ts employee list`
Expected: "No employees. Create one with: nia employee add <name> --project <project> --repo <path>"

- [ ] **Step 4: Commit**

```bash
git add src/cli/employee.ts src/cli/index.ts
git commit -m "feat(employee): add employee CLI (list, show, pause, resume, remove, approvals)"
```

---

### Task 5: Employee Add & Scaffolding

**Files:**

- Create: `src/cli/employee-add.ts`

- [ ] **Step 1: Create the employee add command**

```typescript
// src/cli/employee-add.ts
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { resolve } from "path";
import { getEmployee, getEmployeeDir } from "../core/employees";
import { getNiaHome } from "../utils/paths";
import { fail } from "../utils/cli";

const DEFAULT_BODY = `You are {name}, an autonomous employee working for Aman.
You are responsible for {project}.
You operate independently but seek approval before externally visible actions.

## Your Authority
- Create and manage scheduled jobs scoped to your project
- Create sub-employees (up to {maxSubEmployees}) and agents under your org
- Read/write code in your project repo
- Draft content, PRs, deployments (approval required before publishing)

## Approval Required For
- Deploying code to production
- Publishing content externally
- Creating sub-employees
- Any action visible outside the project repo
- Spending money or signing up for services

## How You Work
- Maintain your goals.md with current priorities
- Log significant decisions in decisions.md with [pending] status when approval needed
- Update memory.md with learnings after each session
- When blocked or facing a big decision, write to decisions.md as [pending] and tell the user
- At the start of each session, review your state files and what's changed in the repo

## State Files
You have persistent state files in your employee directory. Read and update them:
- **goals.md** — your current goals and success criteria
- **memory.md** — what you've learned, decided, observed across sessions
- **decisions.md** — decision log (mark as [pending], [approved], or [rejected])
- **org.md** — sub-employees and agents you've created

## Onboarding
During onboarding, you go through three phases:
1. **Brief** — Ask the user about the project, goals, what's working, what's not. Save to onboarding/brief.md.
2. **Self-Discovery** — Explore the repo autonomously. Save findings to onboarding/discovery.md.
3. **Initial Plan** — Propose top 3-5 priorities. Save to onboarding/plan.md. Get user approval.
After onboarding completes, your status changes to active.`;

export async function employeeAdd(): Promise<void> {
  const args = process.argv.slice(4);
  const name = args[0];
  if (!name || name.startsWith("--")) fail("Usage: nia employee add <name> --project <label> --repo <path>");

  // Parse flags
  const flagValue = (flag: string): string | undefined => {
    const idx = args.indexOf(flag);
    return idx !== -1 && args[idx + 1] ? args[idx + 1] : undefined;
  };

  const project = flagValue("--project");
  const repoArg = flagValue("--repo");
  const role = flagValue("--role") || "Chief of Staff";
  const model = flagValue("--model") || "opus";
  const maxSubs = parseInt(flagValue("--max-sub-employees") || "3", 10);

  if (!project) fail("--project is required");
  if (!repoArg) fail("--repo is required");

  const repo = resolve(repoArg);
  if (!existsSync(repo)) fail(`Repo path does not exist: ${repo}`);

  // Check for existing employee
  if (getEmployee(name)) fail(`Employee "${name}" already exists.`);

  // Scaffold directory
  const empDir = getEmployeeDir(name);
  mkdirSync(empDir, { recursive: true });
  mkdirSync(`${empDir}/onboarding`, { recursive: true });

  // Write EMPLOYEE.md
  const body = DEFAULT_BODY.replace(/\{name\}/g, name)
    .replace(/\{project\}/g, project)
    .replace(/\{maxSubEmployees\}/g, String(maxSubs));

  const frontmatter = [
    "---",
    `name: ${name}`,
    `project: ${project}`,
    `repo: ${repo}`,
    `role: ${role}`,
    `model: ${model}`,
    `status: onboarding`,
    `maxSubEmployees: ${maxSubs}`,
    `created: ${new Date().toISOString().slice(0, 10)}`,
    "---",
  ].join("\n");

  writeFileSync(`${empDir}/EMPLOYEE.md`, `${frontmatter}\n\n${body}\n`);

  // Create empty state files
  writeFileSync(`${empDir}/goals.md`, "# Goals\n\n");
  writeFileSync(`${empDir}/memory.md`, "# Memory\n\n");
  writeFileSync(`${empDir}/decisions.md`, "# Decisions\n\n");
  writeFileSync(`${empDir}/org.md`, "# Organization\n\n");
  writeFileSync(`${empDir}/onboarding/brief.md`, "");
  writeFileSync(`${empDir}/onboarding/discovery.md`, "");
  writeFileSync(`${empDir}/onboarding/plan.md`, "");

  console.log(`Employee "${name}" created.`);
  console.log(`  Role:    ${role}`);
  console.log(`  Project: ${project}`);
  console.log(`  Repo:    ${repo}`);
  console.log(`  Model:   ${model}`);
  console.log(`\nStart onboarding with: nia chat --employee ${name}`);
}
```

- [ ] **Step 2: Test the scaffolding manually**

Run: `bun run src/cli/index.ts employee add testjames --project test.com --repo /tmp`
Expected: Creates `~/.niahere/employees/testjames/` with all files

Run: `bun run src/cli/index.ts employee list`
Expected: Shows testjames

Run: `bun run src/cli/index.ts employee remove testjames`
Expected: Removes the directory

- [ ] **Step 3: Commit**

```bash
git add src/cli/employee-add.ts
git commit -m "feat(employee): add employee scaffolding (nia employee add)"
```

---

### Task 6: Chat Engine Employee Integration

**Files:**

- Modify: `src/chat/engine.ts`
- Modify: `src/chat/repl.ts`
- Modify: `src/cli/index.ts`

- [ ] **Step 1: Extend EngineOptions to support employee**

In `src/types/index.ts` (or wherever EngineOptions is defined), check the EngineOptions type and add `employee?: string`.

First, find where EngineOptions is defined:

```typescript
// In the EngineOptions interface, add:
employee?: string;
```

- [ ] **Step 2: Modify createChatEngine to use employee prompt**

In `src/chat/engine.ts`, after the existing systemPrompt construction (line ~129), add employee override logic:

```typescript
import { buildEmployeePrompt } from "./employee-prompt";
import { getEmployee } from "../core/employees";
```

After `let systemPrompt = buildSystemPrompt("chat", channel);` and the session context injection, add:

```typescript
// Employee mode: override system prompt with employee identity
let employeeCwd = cwd;
if (opts.employee) {
  const empPrompt = buildEmployeePrompt(opts.employee);
  if (empPrompt) {
    systemPrompt = empPrompt;
  }
  const emp = getEmployee(opts.employee);
  if (emp?.repo && existsSync(emp.repo)) {
    employeeCwd = emp.repo;
  }
}
```

Then use `employeeCwd` instead of `cwd` throughout the function (in the `options` object and `sessionFileExists` call).

- [ ] **Step 3: Modify REPL to accept --employee flag**

In `src/chat/repl.ts`, modify `startRepl` signature to accept an employee parameter:

```typescript
export async function startRepl(
  mode: ChatMode = "continue",
  simulateChannel?: string,
  employeeName?: string,
): Promise<void> {
```

Pass it through to createChatEngine:

```typescript
const engine = await createChatEngine({
  room: employeeName ? `employee-${employeeName}` : "terminal",
  channel,
  resume,
  mcpServers: getMcpServers(),
  employee: employeeName,
});
```

Update the welcome message:

```typescript
const employeeNote = employeeName ? ` as ${employeeName}` : "";
console.log(`\n${DIM}nia chat${employeeNote}${channelNote}${RESET} ${DIM}(${sessionNote})${RESET}`);
```

- [ ] **Step 4: Parse --employee flag in CLI index**

In `src/cli/index.ts`, modify the `chat` case:

```typescript
  case "chat": {
    const chatArgs = process.argv.slice(3);
    const mode =
      chatArgs.includes("--continue") || chatArgs.includes("-c")
        ? ("continue" as const)
        : chatArgs.includes("--resume") || chatArgs.includes("-r")
          ? ("pick" as const)
          : ("new" as const);
    const chIdx = chatArgs.indexOf("--channel");
    const simChannel = chIdx !== -1 && chatArgs[chIdx + 1] ? chatArgs[chIdx + 1] : undefined;
    const empIdx = chatArgs.indexOf("--employee");
    const employeeName = empIdx !== -1 && chatArgs[empIdx + 1] ? chatArgs[empIdx + 1] : undefined;
    await startRepl(mode, simChannel, employeeName);
    break;
  }
```

- [ ] **Step 5: Test the integration manually**

Run: `bun run src/cli/index.ts employee add testjames --project test.com --repo /tmp`
Then: `bun run src/cli/index.ts chat --employee testjames`
Expected: Opens chat session with James's identity in the prompt, working in /tmp

Clean up: `bun run src/cli/index.ts employee remove testjames`

- [ ] **Step 6: Commit**

```bash
git add src/chat/engine.ts src/chat/repl.ts src/cli/index.ts src/types/index.ts
git commit -m "feat(employee): integrate employee into chat engine and REPL (--employee flag)"
```

---

### Task 7: Run Full Test Suite & Build Verification

- [ ] **Step 1: Run all tests**

Run: `bun test`
Expected: All tests pass

- [ ] **Step 2: Run the build**

Run: `bun run build` (or the project's build command)
Expected: No type errors, clean build

- [ ] **Step 3: Fix any issues found**

If any tests or build fails, fix inline.

- [ ] **Step 4: Final commit if fixes needed**

```bash
git add -A
git commit -m "fix(employee): address test/build issues"
```
