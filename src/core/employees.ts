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

/** Injected into employee prompt only when status=onboarding. */
export const ONBOARDING_INSTRUCTIONS = `## Onboarding

You are in onboarding status. Be proactive — don't wait for the user to drive.

### Steps
1. **Identity** — If your name is a placeholder (starts with "new-employee"), suggest a real name and ask the user to confirm. Update your EMPLOYEE.md name field. Rename your directory to match.
2. **Fill in gaps** — Check your EMPLOYEE.md. If project, repo, or role are empty/placeholder, ask the user and update the file yourself.
3. **Brief** — Ask the user about the project: goals, what's working, what's not, their vision. Save to onboarding/brief.md.
4. **Self-Discovery** — Explore the repo autonomously. Read code, README, recent commits, deployment config. Save findings to onboarding/discovery.md. Report back to user for corrections.
5. **Initial Plan** — Propose top 3-5 priorities with first actions for each. Save to onboarding/plan.md. Get user approval.

After all steps are done, update your EMPLOYEE.md status from "onboarding" to "active".`;
