import * as readline from "readline";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { resolve } from "path";
import { getEmployee, getEmployeeDir } from "../core/employees";
import { fail, DIM, BOLD, RESET } from "../utils/cli";

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

function ask(rl: readline.Interface, prompt: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(`${BOLD}${prompt}${RESET} `, (answer) => {
      resolve(answer.trim());
    });
  });
}

export async function employeeAdd(): Promise<void> {
  const args = process.argv.slice(4);

  // Parse whatever flags were provided
  const flagValue = (flag: string): string | undefined => {
    const idx = args.indexOf(flag);
    return idx !== -1 && args[idx + 1] && !args[idx + 1].startsWith("--") ? args[idx + 1] : undefined;
  };

  // Positional name (first arg that doesn't start with --)
  let name = args[0] && !args[0].startsWith("--") ? args[0] : undefined;
  let project = flagValue("--project");
  let repoArg = flagValue("--repo");
  let role = flagValue("--role");
  let model = flagValue("--model");
  let maxSubs = flagValue("--max-sub-employees");

  // If anything's missing, ask interactively
  const needsPrompt = !name || !project || !repoArg;

  if (needsPrompt) {
    console.log(`\n${DIM}Setting up a new employee...${RESET}\n`);

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    try {
      if (!name) {
        name = await ask(rl, "Employee name:");
        if (!name) fail("Name is required.");
      }

      if (getEmployee(name)) fail(`Employee "${name}" already exists.`);

      if (!project) {
        project = await ask(rl, "Project (e.g. aicodeusage.com):");
        if (!project) fail("Project is required.");
      }

      if (!repoArg) {
        repoArg = await ask(rl, "Repo path (e.g. /Users/aman/projects/aicodeusage):");
        if (!repoArg) fail("Repo path is required.");
      }

      if (!role) {
        const roleAnswer = await ask(rl, "Role (default: Chief of Staff):");
        if (roleAnswer) role = roleAnswer;
      }

      if (!model) {
        const modelAnswer = await ask(rl, "Model (default: opus):");
        if (modelAnswer) model = modelAnswer;
      }
    } finally {
      rl.close();
    }
  } else {
    if (getEmployee(name!)) fail(`Employee "${name}" already exists.`);
  }

  role = role || "Chief of Staff";
  model = model || "opus";
  const maxSubEmployees = parseInt(maxSubs || "3", 10);

  const repo = resolve(repoArg!);
  if (!existsSync(repo)) fail(`Repo path does not exist: ${repo}`);

  // Scaffold directory
  const empDir = getEmployeeDir(name!);
  mkdirSync(empDir, { recursive: true });
  mkdirSync(`${empDir}/onboarding`, { recursive: true });

  const body = DEFAULT_BODY.replace(/\{name\}/g, name!)
    .replace(/\{project\}/g, project!)
    .replace(/\{maxSubEmployees\}/g, String(maxSubEmployees));

  const frontmatter = [
    "---",
    `name: ${name}`,
    `project: ${project}`,
    `repo: ${repo}`,
    `role: ${role}`,
    `model: ${model}`,
    `status: onboarding`,
    `maxSubEmployees: ${maxSubEmployees}`,
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

  console.log(`\n${BOLD}${name}${RESET} created.`);
  console.log(`  Role:    ${role}`);
  console.log(`  Project: ${project}`);
  console.log(`  Repo:    ${repo}`);
  console.log(`  Model:   ${model}`);
  console.log(`\nStart onboarding: ${BOLD}nia chat --employee ${name}${RESET}`);
}
