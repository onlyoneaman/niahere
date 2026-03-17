import { existsSync, readFileSync, readdirSync } from "fs";
import { join, resolve } from "path";
import { homedir } from "os";
import yaml from "js-yaml";
import { getNiaHome, getPaths } from "../utils/paths";
import { getEnvironmentPrompt, getModePrompt, getChannelPrompt } from "../prompts";
import { log } from "../utils/log";
import type { Mode } from "../types";

// niahere project root (resolved from this file's location)
const PROJECT_ROOT = resolve(import.meta.dir, "../..");

function loadFile(dir: string, name: string): string {
  const filePath = join(dir, name);
  if (!existsSync(filePath)) return "";
  return readFileSync(filePath, "utf8").trim();
}

export function loadIdentity(): string {
  const { selfDir } = getPaths();
  const files = ["identity.md", "owner.md", "soul.md", "rules.md"];
  return files.map((f) => loadFile(selfDir, f)).filter(Boolean).join("\n\n");
}

function scanSkills(): { name: string; description: string }[] {
  const home = homedir();
  const cwd = process.cwd();
  const niaHome = getNiaHome();
  const skillDirs = [
    join(cwd, "skills"),
    join(PROJECT_ROOT, "skills"),
    join(niaHome, "skills"),
    join(home, ".shared", "skills"),
    join(home, ".claude", "skills"),
    join(home, ".codex", "skills"),
  ];

  const skills: { name: string; description: string }[] = [];
  const seen = new Set<string>();

  for (const dir of skillDirs) {
    if (!existsSync(dir)) continue;

    for (const entry of readdirSync(dir, { withFileTypes: true })) {
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

      if (seen.has(name)) continue;
      seen.add(name);

      skills.push({
        name,
        description: typeof meta.description === "string" ? meta.description : "",
      });
    }
  }

  return skills;
}

export function loadSkillNames(): string[] {
  return scanSkills().map((s) => s.name);
}

export function loadSkillsSummary(): string {
  const skills = scanSkills();
  if (skills.length === 0) return "";

  const lines = skills.map((s) =>
    s.description ? `- /${s.name}: ${s.description}` : `- /${s.name}`,
  );
  return `Available skills:\n${lines.join("\n")}`;
}

export function buildSystemPrompt(mode: Mode = "chat", channel: string = "terminal"): string {
  const parts: string[] = [];

  const identity = loadIdentity();
  if (identity) parts.push(identity);

  parts.push(getEnvironmentPrompt());

  const modePrompt = getModePrompt(mode);
  if (modePrompt) parts.push(modePrompt);

  const channelPrompt = getChannelPrompt(channel);
  if (channelPrompt) parts.push(channelPrompt);

  const skills = loadSkillsSummary();
  if (skills) parts.push(skills);

  return parts.join("\n\n");
}
