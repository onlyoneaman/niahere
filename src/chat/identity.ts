import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { getPaths } from "../utils/paths";
import { getEnvironmentPrompt, getModePrompt, getChannelPrompt } from "../prompts";
import { getSkillsSummary } from "../core/skills";
import { getAgentsSummary } from "../core/agents";
import { getEmployeesSummary } from "../core/employees";
import { Session } from "../db/models";
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
  const files = ["identity.md", "owner.md", "soul.md", "rules.md", "memory.md"];
  return files
    .map((f) => loadFile(selfDir, f))
    .filter(Boolean)
    .join("\n\n");
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

  const employees = getEmployeesSummary();
  if (employees) parts.push(employees);

  return parts.join("\n\n");
}

/**
 * Load recent session summaries for a room and format as a context block.
 * Returns empty string if no summaries are available.
 */
export async function getSessionContext(room: string): Promise<string> {
  try {
    const summaries = await Session.getRecentSummaries(room, 3);
    if (summaries.length === 0) return "";

    const lines = summaries
      .reverse() // oldest first
      .map((s) => `- (${s.updatedAt}): ${s.summary}`)
      .join("\n");

    return `## Recent Session Context\nBrief summaries of your last few sessions in this room — use for continuity:\n${lines}`;
  } catch {
    return "";
  }
}
