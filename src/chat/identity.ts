import { existsSync, readFileSync, readdirSync } from "fs";
import { join, resolve } from "path";
import { homedir } from "os";
import yaml from "js-yaml";
import { getNiaHome, getPaths } from "../utils/paths";
import { getConfig } from "../utils/config";
import { localTime } from "../utils/time";

// niahere project root (resolved from this file's location)
const PROJECT_ROOT = resolve(import.meta.dir, "../..");

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
  const cwd = process.cwd();
  const niaHome = getNiaHome();
  const skillDirs = [
    // Project/cwd skills first (most specific)
    join(cwd, "skills"),
    // niahere bundled skills
    join(PROJECT_ROOT, "skills"),
    // User-installed skills
    join(niaHome, "skills"),
    // User-level skills
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
      try { meta = (yaml.load(fmMatch[1]) as Record<string, unknown>) || {}; } catch { continue; }
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

function buildEnvironmentContext(): string {
  const paths = getPaths();
  const config = getConfig();

  return `## Environment

You are running as part of the **nia** assistant daemon.
- Config: ${paths.config}
- Database: PostgreSQL (${config.database_url.replace(/\/\/.*@/, "//***@")})
- Persona files: ${paths.selfDir}/
- Timezone: ${config.timezone}
- Current time: ${localTime()}

## Managing Jobs

You have MCP tools for managing jobs directly — no need for shell commands:

- **list_jobs** — see all scheduled jobs with status and next run time
- **add_job** — create a new job. Supports three schedule types:
  - \`cron\`: standard cron expression (e.g., "0 9 * * *" = daily at 9am, "*/5 * * * *" = every 5 min)
  - \`interval\`: duration string (e.g., "5m", "2h", "1d" = every 5 min/2 hours/1 day)
  - \`once\`: ISO timestamp for one-time execution (e.g., "2026-03-14T10:00:00")
  - Set \`always: true\` to run 24/7 (ignores active hours)
- **remove_job** — delete a job by name
- **enable_job** / **disable_job** — toggle a job on or off
- **run_job** — trigger a job to run immediately
- **send_message** — send a message to the user (via telegram, slack, or default channel). Supports \`media_path\` to send images/files.
- **list_messages** — read recent chat history

Active hours: ${config.activeHours.start}–${config.activeHours.end} (${config.timezone}). Jobs respect this; crons (always=true) don't.

## Managing Config

Config file: \`${paths.config}\`

Current config:
- model: ${config.model}
- timezone: ${config.timezone}
- active_hours: ${config.activeHours.start}–${config.activeHours.end}
- log_level: ${config.log_level}

You can read and edit this file directly to change settings. Examples:
\`\`\`bash
cat ${paths.config}                          # view config
sed -i '' 's/model: .*/model: claude-sonnet-4-5-20250514/' ${paths.config}  # change model
\`\`\`

After config changes, run \`nia restart\` to apply.

Config reference:
- \`model\` — AI model to use for jobs (default: "default")
- \`timezone\` — timezone for scheduling and timestamps (e.g. "America/New_York")
- \`active_hours.start\` / \`active_hours.end\` — HH:MM window when jobs run. Crons (--always) ignore this.
- \`log_level\` — daemon log verbosity: "debug", "info", "warn", "error", "silent"
- \`telegram_bot_token\` — Telegram bot API token
- \`telegram_chat_id\` — owner's chat ID (auto-registered on first message, used for outbound)
- \`telegram_open\` — if true, anyone can message the bot. If false (default), only the owner can.
- \`slack_bot_token\` — Slack bot token (xoxb-...)
- \`slack_app_token\` — Slack app token (xapp-...) for Socket Mode
- \`slack_channel_id\` — default Slack channel for outbound messages
- \`default_channel\` — which channel send_message uses by default ("telegram" or "slack")

## Persona & Memory

Your persona files live in ${paths.selfDir}/:
- \`identity.md\` — your personality and voice
- \`owner.md\` — info about who runs you
- \`soul.md\` — operating principles
- \`memory.md\` — persistent learnings (you can append to this)

To remember something, append to ${paths.selfDir}/memory.md using a shell command.`;
}

export function buildSystemPrompt(mode: "chat" | "job" = "chat", channel: "terminal" | "telegram" | string = "terminal"): string {
  const identity = loadIdentity();
  const parts: string[] = [];

  if (identity) {
    parts.push(identity);
  }

  parts.push(buildEnvironmentContext());

  if (mode === "chat") {
    parts.push("## Mode: Chat\nYou are in a live chat session. Be conversational, helpful, and concise. You can run shell commands to manage jobs, read files, or check system state.");
  } else {
    parts.push("## Mode: Job\nYou are executing a scheduled job. Be terse — execute the task and report the result. No small talk.");
  }

  if (channel === "slack") {
    parts.push(`## Channel: Slack
- Use Slack mrkdwn formatting: *bold*, _italic_, \`code\`, \`\`\`code blocks\`\`\`
- Keep responses clear and well-structured.
- Use bullet points and numbered lists where appropriate.
- You can use <url|text> for links.`);
  } else if (channel === "telegram") {
    parts.push(`## Channel: Telegram
- Keep responses short — this is a mobile chat, not a terminal.
- Do NOT include sources, links, or references unless explicitly asked.
- Do NOT use code blocks for simple answers.
- Use MarkdownV2 formatting: *bold*, _italic_, \`code\`. Escape special chars: \\. \\! \\- \\( \\)
- Avoid long lists — summarize instead.
- No headers (#) — Telegram doesn't render them.`);
  }

  const skills = loadSkillsSummary();
  if (skills) {
    parts.push(skills);
  }

  return parts.join("\n\n");
}
