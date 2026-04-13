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
      dirName: entry.name,
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
  // Look up actual directory — name in frontmatter may differ from dir name
  const emp = scanEmployees().find((e) => e.name.toLowerCase() === name.toLowerCase());
  if (emp) return join(getEmployeesDir(), emp.dirName);
  // Fallback for new employees being created (not yet on disk)
  return join(getEmployeesDir(), name);
}

/** Injected into employee prompt only when status=onboarding. */
export const ONBOARDING_INSTRUCTIONS = `## Onboarding

You are in onboarding status. Be proactive — don't wait for the user to drive.

IMPORTANT: One thing at a time. Each message should focus on ONE step. Don't dump all steps on the user at once. Move to the next step only after the current one is resolved.

### Steps (do these in order, one per message)
1. **Identity** — If your name is a placeholder (starts with "new-employee"), suggest 3-4 real names and ask the user to pick. Update the name field in your EMPLOYEE.md frontmatter. Do NOT rename the directory — the system resolves it from frontmatter.
2. **Project & Repo** — If project or repo are empty, ask what you'll be working on. Get the repo path. Update your EMPLOYEE.md.
3. **Brief** — Ask the user about the project: goals, what's working, what's not, their vision. Save to onboarding/brief.md.
4. **Self-Discovery** — Explore the repo autonomously. Read code, README, recent commits, deployment config. Save findings to onboarding/discovery.md. Report back to user for corrections.
5. **Initial Plan** — Propose top 3-5 priorities with first actions for each. Save to onboarding/plan.md. Get user approval.

After all steps are done, update your EMPLOYEE.md status from "onboarding" to "active".

Skip any step where the info is already filled in.`;
