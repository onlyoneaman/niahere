import { existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { getPaths } from "../utils/paths";

export function loadIdentity(workspace: string): string {
  const { selfDir } = getPaths(workspace);
  const parts: string[] = [];

  const identityPath = join(selfDir, "identity.md");
  if (existsSync(identityPath)) {
    parts.push(readFileSync(identityPath, "utf8").trim());
  }

  const soulPath = join(selfDir, "soul.md");
  if (existsSync(soulPath)) {
    parts.push(readFileSync(soulPath, "utf8").trim());
  }

  return parts.join("\n\n");
}

/**
 * Scan skill directories for SKILL.md files and extract name + description
 * from YAML frontmatter. Returns a summary string for the system prompt.
 */
export function loadSkillsSummary(): string {
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

  if (skills.length === 0) return "";

  const lines = skills.map((s) =>
    s.description ? `- /${s.name}: ${s.description}` : `- /${s.name}`,
  );
  return `Available skills:\n${lines.join("\n")}`;
}

export function buildSystemPrompt(workspace: string): string {
  const identity = loadIdentity(workspace);
  const parts: string[] = [];

  if (identity) {
    parts.push(identity);
  }

  parts.push("You are in a live chat session. Be conversational, helpful, and concise.");

  const skills = loadSkillsSummary();
  if (skills) {
    parts.push(skills);
  }

  return parts.join("\n\n");
}
