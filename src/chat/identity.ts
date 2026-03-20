import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { getPaths } from "../utils/paths";
import { getEnvironmentPrompt, getModePrompt, getChannelPrompt } from "../prompts";
import { getSkillsSummary } from "../core/skills";
import { getAgentsSummary } from "../core/agents";
import type { Mode } from "../types";

// Re-export for backwards compat
export { scanSkills as loadSkills, getSkillNames as loadSkillNames, type SkillInfo } from "../core/skills";

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

export function buildSystemPrompt(mode: Mode = "chat", channel: string = "terminal"): string {
  const parts: string[] = [];

  const identity = loadIdentity();
  if (identity) parts.push(identity);

  parts.push(getEnvironmentPrompt());

  const modePrompt = getModePrompt(mode);
  if (modePrompt) parts.push(modePrompt);

  const channelPrompt = getChannelPrompt(channel);
  if (channelPrompt) parts.push(channelPrompt);

  const skills = getSkillsSummary();
  if (skills) parts.push(skills);

  const agents = getAgentsSummary();
  if (agents) parts.push(agents);

  return parts.join("\n\n");
}
