import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { getEmployee, getEmployeeDir } from "../core/employees";
import { ONBOARDING_INSTRUCTIONS } from "../core/employees";
import { getEnvironmentPrompt, getModePrompt } from "../prompts";
import { getSkillsSummary } from "../core/skills";
import { getAgentsSummary } from "../core/agents";

function loadFile(dir: string, name: string): string {
  const filePath = join(dir, name);
  if (!existsSync(filePath)) return "";
  return readFileSync(filePath, "utf8").trim();
}

export function buildEmployeePrompt(name: string): string {
  const employee = getEmployee(name);
  if (!employee) return "";

  const dir = getEmployeeDir(name);
  const parts: string[] = [];

  // Core identity (the EMPLOYEE.md body)
  if (employee.body) parts.push(employee.body);

  // Environment + mode + capabilities
  parts.push(getEnvironmentPrompt());

  const modePrompt = getModePrompt("chat");
  if (modePrompt) parts.push(modePrompt);

  const skills = getSkillsSummary();
  if (skills) parts.push(skills);

  const agents = getAgentsSummary();
  if (agents) parts.push(agents);

  // Onboarding instructions (only when status=onboarding)
  if (employee.status === "onboarding") {
    parts.push(ONBOARDING_INSTRUCTIONS);
  }

  // Employee metadata context
  parts.push(`## Your Profile
- **Name:** ${employee.name}
- **Role:** ${employee.role}
- **Project:** ${employee.project}
- **Repo:** ${employee.repo}
- **Status:** ${employee.status}
- **Max Sub-Employees:** ${employee.maxSubEmployees}`);

  // State files
  const goals = loadFile(dir, "goals.md");
  if (goals) parts.push(`## Your Current Goals\n${goals}`);

  const memory = loadFile(dir, "memory.md");
  if (memory) parts.push(`## Your Memory\n${memory}`);

  const decisions = loadFile(dir, "decisions.md");
  if (decisions) parts.push(`## Decision Log\n${decisions}`);

  const org = loadFile(dir, "org.md");
  if (org) parts.push(`## Your Organization\n${org}`);

  // Onboarding context
  const brief = loadFile(join(dir, "onboarding"), "brief.md");
  if (brief) parts.push(`## Onboarding Brief\n${brief}`);

  const discovery = loadFile(join(dir, "onboarding"), "discovery.md");
  if (discovery) parts.push(`## Self-Discovery Notes\n${discovery}`);

  const plan = loadFile(join(dir, "onboarding"), "plan.md");
  if (plan) parts.push(`## Initial Plan\n${plan}`);

  return parts.join("\n\n");
}
