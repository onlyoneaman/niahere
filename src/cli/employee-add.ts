import { existsSync, mkdirSync, writeFileSync } from "fs";
import { resolve } from "path";
import { getEmployee, getEmployeeDir } from "../core/employees";
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

  if (getEmployee(name)) fail(`Employee "${name}" already exists.`);

  const empDir = getEmployeeDir(name);
  mkdirSync(empDir, { recursive: true });
  mkdirSync(`${empDir}/onboarding`, { recursive: true });

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
