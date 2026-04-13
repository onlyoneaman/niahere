import { existsSync, mkdirSync, writeFileSync } from "fs";
import { resolve } from "path";
import { getEmployee, getEmployeeDir } from "../core/employees";
import { fail, BOLD, RESET } from "../utils/cli";
import { startRepl } from "../chat/repl";

// Permanent identity — stays in EMPLOYEE.md after onboarding
const CORE_BODY = `You are {name}, a co-founder working with Aman.
{projectLine}
You operate independently but seek approval before externally visible actions.

## Who You Are
You are NOT an assistant. You are a co-founder and thought partner. This means:
- Challenge ideas that seem weak, unfocused, or premature. Say "I don't think that's the right move because..." not "Great idea!"
- Ask hard questions: "Who actually wants this?", "What's the evidence?", "Why this over the 5 easier things?"
- Have strong opinions, loosely held. Push back, but update when presented with better reasoning.
- Be direct. No filler, no sycophancy, no "Got it!", no performative enthusiasm.
- Think critically about priorities. "We could, but should we?" is more valuable than "On it!"
- When Aman tells you something, probe it. A real co-founder doesn't just accept the brief — they stress-test it.

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
- **org.md** — sub-employees and agents you've created`;

export async function employeeAdd(): Promise<void> {
  const args = process.argv.slice(4);

  const flagValue = (flag: string): string | undefined => {
    const idx = args.indexOf(flag);
    return idx !== -1 && args[idx + 1] && !args[idx + 1].startsWith("--") ? args[idx + 1] : undefined;
  };

  const nameArg = args[0] && !args[0].startsWith("--") ? args[0] : undefined;
  const name = nameArg || `new-employee-${Math.random().toString(36).slice(2, 6)}`;
  const project = flagValue("--project") || "";
  const repoArg = flagValue("--repo") || "";
  const role = flagValue("--role") || "Co-Founder";
  const model = flagValue("--model") || "opus";
  const maxSubs = parseInt(flagValue("--max-sub-employees") || "3", 10);

  if (getEmployee(name)) fail(`Employee "${name}" already exists.`);

  const repo = repoArg ? resolve(repoArg) : "";
  if (repo && !existsSync(repo)) fail(`Repo path does not exist: ${repo}`);

  // Scaffold directory
  const empDir = getEmployeeDir(name);
  mkdirSync(empDir, { recursive: true });
  mkdirSync(`${empDir}/onboarding`, { recursive: true });

  const projectLine = project ? `You are responsible for ${project}.` : "";

  const body = CORE_BODY.replace(/\{name\}/g, name)
    .replace(/\{projectLine\}\n/g, projectLine ? `${projectLine}\n` : "")
    .replace(/\{maxSubEmployees\}/g, String(maxSubs));

  const frontmatter = [
    "---",
    `name: ${name}`,
    `project: "${project}"`,
    `repo: "${repo}"`,
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

  // Build a context-aware kickoff message so the agent starts proactively
  const provided: string[] = [];
  const missing: string[] = [];

  if (nameArg) provided.push(`name: ${nameArg}`);
  else missing.push("name (placeholder assigned — suggest a real one)");

  if (project) provided.push(`project: ${project}`);
  else missing.push("project");

  if (repo) provided.push(`repo: ${repo}`);
  else missing.push("repo path");

  const initialMessage = [
    "New employee created. Start onboarding.",
    provided.length > 0 ? `Provided: ${provided.join(", ")}.` : "Nothing provided yet.",
    missing.length > 0 ? `Missing: ${missing.join(", ")}.` : "All basics provided — proceed to brief.",
  ].join(" ");

  console.log(`\n${BOLD}${name}${RESET} created — starting onboarding...\n`);

  await startRepl("new", undefined, { employee: name, initialMessage });
}
