import { existsSync, readFileSync, readdirSync } from "fs";
import { join, resolve } from "path";
import { homedir } from "os";
import yaml from "js-yaml";
import { getNiaHome } from "../utils/paths";
import { log } from "../utils/log";

// niahere project root (resolved from this file's location)
const PROJECT_ROOT = resolve(import.meta.dir, "../..");

export type SkillInfo = { name: string; description: string; source: string };

const SKILL_DIRS: { dir: string; source: string }[] = [
  { dir: join(process.cwd(), "skills"), source: "cwd" },
  { dir: join(PROJECT_ROOT, "skills"), source: "project" },
  { dir: join(getNiaHome(), "skills"), source: "nia" },
  { dir: join(homedir(), ".shared", "skills"), source: "shared" },
  { dir: join(homedir(), ".claude", "skills"), source: "claude" },
  { dir: join(homedir(), ".codex", "skills"), source: "codex" },
];

export function scanSkills(): SkillInfo[] {
  const skills: SkillInfo[] = [];
  const seen = new Set<string>();

  for (const { dir, source } of SKILL_DIRS) {
    if (!existsSync(dir)) continue;

    const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;

      const skillFile = join(dir, entry.name, "SKILL.md");
      if (!existsSync(skillFile)) continue;

      const content = readFileSync(skillFile, "utf8");
      const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
      if (!fmMatch) continue;

      let meta: Record<string, unknown> = {};
      try {
        meta = (yaml.load(fmMatch[1]) as Record<string, unknown>) || {};
      } catch (err) {
        log.warn({ err, skill: entry.name, path: skillFile }, "failed to parse skill metadata, skipping");
        continue;
      }
      const name = (typeof meta.name === "string" ? meta.name : "") || entry.name;

      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);

      skills.push({
        name,
        description: typeof meta.description === "string" ? meta.description : "",
        source,
      });
    }
  }

  return skills;
}

export function getSkillNames(): string[] {
  return scanSkills().map((s) => s.name);
}

export function getSkillsSummary(): string {
  const skills = scanSkills();
  if (skills.length === 0) return "";
  const lines = skills.map((s) => (s.description ? `- /${s.name}: ${s.description}` : `- /${s.name}`));
  return `Available skills:\n${lines.join("\n")}`;
}
