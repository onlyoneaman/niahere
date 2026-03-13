import { existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { getPaths } from "../utils/paths";

function loadFile(dir: string, name: string): string {
  const filePath = join(dir, name);
  if (!existsSync(filePath)) return "";
  return readFileSync(filePath, "utf8").trim();
}

export function loadIdentity(): string {
  const { selfDir } = getPaths();
  const files = ["identity.md", "owner.md", "soul.md", "memory.md"];
  return files.map((f) => loadFile(selfDir, f)).filter(Boolean).join("\n\n");
}

function scanSkills(): { name: string; description: string }[] {
  const home = homedir();
  const skillDirs = [
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
      const frontmatter = content.match(/^---\n([\s\S]*?)\n---/);
      if (!frontmatter) continue;

      const nameMatch = frontmatter[1].match(/^name:\s*(.+)$/m);
      const descMatch = frontmatter[1].match(/^description:\s*"?(.+?)"?\s*$/m);
      const name = nameMatch?.[1]?.trim() || entry.name;

      if (seen.has(name)) continue;
      seen.add(name);

      skills.push({
        name,
        description: descMatch?.[1]?.trim() || "",
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

export function buildSystemPrompt(): string {
  const identity = loadIdentity();
  const parts: string[] = [];

  if (identity) {
    parts.push(identity);
  }

  parts.push("You are in a live chat session. Be conversational, helpful, and concise.");

  // Memory path for the agent to write to
  const memoryPath = join(getPaths().selfDir, "memory.md");
  parts.push(`If you learn something non-obvious that would save time in future sessions (a gotcha, a preference, a correction), append it to ${memoryPath} using a shell command. Keep entries short — one line per learning.`);

  const skills = loadSkillsSummary();
  if (skills) {
    parts.push(skills);
  }

  return parts.join("\n\n");
}
