import { existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import yaml from "js-yaml";
import { getPaths } from "../utils/paths";
import { getConfig } from "../utils/config";
import { localTime } from "../utils/time";

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

You have access to a PostgreSQL database with a \`jobs\` table. To manage jobs, use the \`nia\` CLI:

\`\`\`bash
nia job list                              # list all jobs
nia job status <name>                     # show job details + last run status
nia job add <name> "<schedule>" <prompt>   # add a cron job
nia job remove <name>                     # delete a job
nia job enable <name>                     # enable a disabled job
nia job disable <name>                    # disable a job
nia job run <name>                        # run a job immediately
\`\`\`

Changes are picked up automatically by the daemon (no restart needed).
Cron schedule format: minute hour day-of-month month day-of-week (e.g. "*/5 * * * *" = every 5 min, "0 9 * * *" = daily at 9am).

## Managing Config

Config file: ${paths.config}
To view: \`cat ${paths.config}\`
To update a field: edit the YAML file directly.
After config changes, run \`nia restart\` to apply.

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

  if (channel === "telegram") {
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
