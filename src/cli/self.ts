import { existsSync, readFileSync, copyFileSync } from "fs";
import { join } from "path";
import { getPaths } from "../utils/paths";
import { fail } from "../utils/cli";

function selfFilePath(name: "rules" | "memory"): string {
  const { selfDir } = getPaths();
  return join(selfDir, `${name}.md`);
}

function defaultFilePath(name: "rules" | "memory"): string {
  const projectRoot = join(import.meta.dir, "../..");
  return join(projectRoot, "defaults", "self", `${name}.md`);
}

function show(name: "rules" | "memory"): void {
  const path = selfFilePath(name);
  if (!existsSync(path)) {
    console.log(`No ${name}.md found.`);
    return;
  }
  console.log(readFileSync(path, "utf8").trim());
}

function reset(name: "rules" | "memory"): void {
  const path = selfFilePath(name);
  const defaultPath = defaultFilePath(name);

  if (!existsSync(defaultPath)) {
    fail(`Default ${name}.md template not found.`);
  }

  if (existsSync(path)) {
    copyFileSync(path, `${path}.bak`);
    console.log(`  backed up → ${name}.md.bak`);
  }

  copyFileSync(defaultPath, path);
  console.log(`  ${name}.md reset to default.`);
}

export function rulesCommand(): void {
  const sub = process.argv[3];
  switch (sub) {
    case "show":
    case undefined:
      show("rules");
      break;
    case "reset":
      reset("rules");
      break;
    default:
      console.log("Usage: nia rules <show|reset>");
      console.log("  show   — display current rules (default)");
      console.log("  reset  — reset to default template (backs up current)");
  }
}

export function memoryCommand(): void {
  const sub = process.argv[3];
  switch (sub) {
    case "show":
    case undefined:
      show("memory");
      break;
    case "reset":
      reset("memory");
      break;
    default:
      console.log("Usage: nia memory <show|reset>");
      console.log("  show   — display current memory (default)");
      console.log("  reset  — reset to default template (backs up current)");
  }
}
