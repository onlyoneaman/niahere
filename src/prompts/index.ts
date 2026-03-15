import { existsSync, readFileSync } from "fs";
import { join, resolve } from "path";
import { getPaths } from "../utils/paths";
import { getConfig } from "../utils/config";
import { localTime } from "../utils/time";
import type { Mode } from "../types";

const PROMPTS_DIR = resolve(import.meta.dir);

function loadPrompt(name: string): string {
  const filePath = join(PROMPTS_DIR, name);
  if (!existsSync(filePath)) return "";
  return readFileSync(filePath, "utf8").trim();
}

function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? "");
}

export function getEnvironmentPrompt(): string {
  const paths = getPaths();
  const config = getConfig();

  return interpolate(loadPrompt("environment.md"), {
    configPath: paths.config,
    dbUrl: config.database_url.replace(/\/\/.*@/, "//***@"),
    selfDir: paths.selfDir,
    timezone: config.timezone,
    currentTime: localTime(),
    activeStart: config.activeHours.start,
    activeEnd: config.activeHours.end,
    model: config.model,
    logLevel: config.log_level,
  });
}

export function getModePrompt(mode: Mode): string {
  return loadPrompt(mode === "chat" ? "mode-chat.md" : "mode-job.md");
}

export function getChannelPrompt(channel: string): string {
  return loadPrompt(`channel-${channel}.md`);
}
