import { existsSync, readFileSync } from "fs";
import { join, resolve } from "path";
import { getPaths } from "../utils/paths";
import { getConfig } from "../utils/config";
import { formatPromptDate, formatPromptDateTime } from "../utils/time";
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
  const now = new Date();

  // Build watch channel summary if Slack is configured with watch channels
  let slackWatch = "";
  const watch = config.channels.slack.watch;
  if (watch) {
    const entries = Object.entries(watch).map(([name, cfg]) => `  - #${name}: ${cfg.behavior}`);
    slackWatch = `\nActive watch channels:\n${entries.join("\n")}`;
  }

  return interpolate(loadPrompt("environment.md"), {
    configPath: paths.config,
    dbUrl: config.database_url.replace(/\/\/.*@/, "//***@"),
    selfDir: paths.selfDir,
    timezone: config.timezone,
    currentDate: formatPromptDate(now, config.timezone),
    currentTime: formatPromptDateTime(now, config.timezone),
    activeStart: config.activeHours.start,
    activeEnd: config.activeHours.end,
    model: config.model,
    logLevel: config.log_level,
    slackWatch,
  });
}

export function getModePrompt(mode: Mode): string {
  const parts: string[] = [];
  const common = loadPrompt("mode-common.md");
  if (common) parts.push(common);
  const specific = loadPrompt(mode === "chat" ? "mode-chat.md" : "mode-job.md");
  if (specific) parts.push(specific);
  return parts.join("\n\n");
}

export function getChannelPrompt(channel: string): string {
  const parts: string[] = [];
  // Load common channel rules for non-terminal channels
  if (channel !== "terminal") {
    const common = loadPrompt("channel-common.md");
    if (common) parts.push(common);
  }
  const specific = loadPrompt(`channel-${channel}.md`);
  if (specific) parts.push(specific);
  return parts.join("\n\n");
}
