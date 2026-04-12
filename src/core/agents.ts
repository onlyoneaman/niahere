import { existsSync, readFileSync, readdirSync } from "fs";
import { join, resolve } from "path";
import { homedir } from "os";
import yaml from "js-yaml";
import { getNiaHome } from "../utils/paths";
import { log } from "../utils/log";
import type { AgentInfo } from "../types/agent";

// niahere project root (resolved from this file's location)
const PROJECT_ROOT = resolve(import.meta.dir, "../..");

function getAgentDirs(): { dir: string; source: string }[] {
  const niaHome = getNiaHome();
  const dirs: { dir: string; source: string }[] = [
    { dir: join(process.cwd(), "agents"), source: "cwd" },
    { dir: join(PROJECT_ROOT, "agents"), source: "project" },
    { dir: join(niaHome, "agents"), source: "nia" },
    { dir: join(homedir(), ".shared", "agents"), source: "shared" },
  ];
  // Deduplicate paths (cwd, project, and nia may overlap)
  const seen = new Set<string>();
  return dirs.filter(({ dir }) => {
    const resolved = resolve(dir);
    if (seen.has(resolved)) return false;
    seen.add(resolved);
    return true;
  });
}

export function scanAgents(): AgentInfo[] {
  const agents: AgentInfo[] = [];
  const seen = new Set<string>();

  for (const { dir, source } of getAgentDirs()) {
    if (!existsSync(dir)) continue;

    const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;

      const agentFile = join(dir, entry.name, "AGENT.md");
      if (!existsSync(agentFile)) continue;

      const content = readFileSync(agentFile, "utf8");
      const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
      if (!fmMatch) continue;

      let meta: Record<string, unknown> = {};
      try {
        meta = (yaml.load(fmMatch[1]) as Record<string, unknown>) || {};
      } catch (err) {
        log.warn({ err, agent: entry.name, path: agentFile }, "failed to parse agent metadata, skipping");
        continue;
      }
      const name = (typeof meta.name === "string" ? meta.name : "") || entry.name;

      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);

      const body = content.replace(/^---\n[\s\S]*?\n---\n*/, "").trim();

      agents.push({
        name,
        description: typeof meta.description === "string" ? meta.description : "",
        body,
        model: typeof meta.model === "string" ? meta.model : undefined,
        source,
      });
    }
  }

  return agents;
}

export function getAgentsSummary(): string {
  const agents = scanAgents();
  if (agents.length === 0) return "";
  const lines = agents.map((a) => (a.description ? `- @${a.name}: ${a.description}` : `- @${a.name}`));
  return `Available agents:\n${lines.join("\n")}`;
}

export function getAgentDefinitions(): Record<string, { description: string; prompt: string; model?: string }> {
  const agents = scanAgents();
  const defs: Record<string, { description: string; prompt: string; model?: string }> = {};

  for (const agent of agents) {
    defs[agent.name] = {
      description: agent.description,
      prompt: agent.body,
      ...(agent.model ? { model: agent.model } : {}),
    };
  }

  return defs;
}
