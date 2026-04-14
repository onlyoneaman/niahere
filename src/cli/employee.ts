import { existsSync, readFileSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { scanEmployees, getEmployee, getEmployeeDir } from "../core/employees";
import { fail, DIM, RESET } from "../utils/cli";

const HELP = `Usage: nia employee <command>

Commands:
  list                    List all employees
  show <name>             Show employee details and state
  add <name>              Create employee and start onboarding
    --project <label>     Project name (required)
    --repo <path>         Project repo path (required)
    --role <role>         Role title (default: "Chief of Staff")
    --model <model>       Model override (default: opus)
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

      const dir = getEmployeeDir(name);
      const goals = loadFilePreview(join(dir, "goals.md"));
      if (goals) console.log(`\n--- Goals ---\n${goals}`);
      const pendingCount = loadFilePendingCount(join(dir, "decisions.md"));
      if (pendingCount > 0) console.log(`\nPending approvals: ${pendingCount}`);
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
      const { employeeAdd } = await import("./employee-add");
      await employeeAdd();
      break;
    }

    default: {
      // If subcommand matches an employee name, start chat
      if (subcommand) {
        const emp = getEmployee(subcommand);
        if (emp) {
          const { startRepl } = await import("../chat/repl");
          await startRepl("continue", undefined, { employee: emp.name });
          break;
        }
      }
      if (subcommand) console.error(`Unknown subcommand: ${subcommand}`);
      console.log(HELP);
      process.exit(subcommand ? 1 : 0);
    }
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
