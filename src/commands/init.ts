import * as readline from "readline";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { getNiaHome, getPaths } from "../utils/paths";
import { resetConfig } from "../utils/config";
import { runMigrations } from "../db/migrate";
import { closeDb } from "../db/connection";
import { startDaemon, isRunning } from "../core/daemon";
import yaml from "js-yaml";

function ask(rl: readline.Interface, question: string, defaultValue?: string): Promise<string> {
  const suffix = defaultValue ? ` [${defaultValue}]` : "";
  return new Promise((resolve) => {
    rl.question(`${question}${suffix}: `, (answer) => {
      resolve(answer.trim() || defaultValue || "");
    });
  });
}

function writeIfMissing(filePath: string, content: string, label: string): void {
  if (existsSync(filePath)) {
    console.log(`  - ${label} already exists, skipping`);
  } else {
    writeFileSync(filePath, content);
    console.log(`  \u2713 created ${label}`);
  }
}

export async function runInit(): Promise<void> {
  const home = getNiaHome();
  const paths = getPaths();

  console.log("Setting up nia...\n");

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    // Load existing config if present
    let existing: Record<string, unknown> = {};
    if (existsSync(paths.config)) {
      try {
        const parsed = yaml.load(readFileSync(paths.config, "utf8"));
        if (parsed && typeof parsed === "object") {
          existing = parsed as Record<string, unknown>;
        }
      } catch {
        // corrupt — start fresh
      }
    }

    // Database URL
    const defaultDb = (existing.database_url as string) || "postgres://localhost:5432/niahere";
    const dbUrl = await ask(rl, "Database URL", defaultDb);

    // Test connection + migrate
    process.env.DATABASE_URL = dbUrl;
    resetConfig();
    try {
      await runMigrations();
      console.log("  \u2713 connected, ran migrations");
      await closeDb();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`  \u2717 could not connect: ${msg}`);
      console.log("  (you can fix this later in ~/.niahere/config.yaml)\n");
    }
    delete process.env.DATABASE_URL;

    // Telegram
    const defaultToken = (existing.telegram_bot_token as string) || "";
    const telegramToken = await ask(rl, "Telegram bot token (Enter to skip)", defaultToken);

    let telegramChatId: number | null = (existing.telegram_chat_id as number) || null;
    if (telegramToken) {
      const defaultChatId = telegramChatId ? String(telegramChatId) : "";
      const chatIdStr = await ask(rl, "Telegram chat ID (Enter to skip)", defaultChatId);
      if (chatIdStr) telegramChatId = Number(chatIdStr);
    }

    // Owner info
    console.log("\nAbout you:");
    const ownerName = await ask(rl, "Your name");
    const ownerRole = await ask(rl, "What do you do? (e.g. software engineer, student)", "");
    const ownerInterests = await ask(rl, "Interests (comma-separated, Enter to skip)", "");

    // Agent name
    const agentName = await ask(rl, "\nAgent name", "nia");

    rl.close();

    // Create directories
    mkdirSync(home, { recursive: true });
    mkdirSync(paths.selfDir, { recursive: true });
    mkdirSync(`${home}/tmp`, { recursive: true });

    // Write config.yaml
    const config: Record<string, unknown> = {
      database_url: dbUrl,
      model: (existing.model as string) || "default",
      timezone: (existing.timezone as string) || Intl.DateTimeFormat().resolvedOptions().timeZone,
      log_level: (existing.log_level as string) || "info",
      active_hours: (existing.active_hours as Record<string, string>) || { start: "00:00", end: "23:59" },
    };

    if (telegramToken) {
      config.telegram_bot_token = telegramToken;
      if (telegramChatId) config.telegram_chat_id = telegramChatId;
    }

    writeFileSync(paths.config, yaml.dump(config, { lineWidth: -1 }));
    console.log("\n  \u2713 wrote ~/.niahere/config.yaml");

    // --- Self files ---

    // identity.md
    writeIfMissing(
      `${paths.selfDir}/identity.md`,
      `# ${agentName}

You are ${agentName}, a personal AI assistant. You run as a background daemon, handle scheduled tasks, and chat when needed.

## Voice
- Direct and concise. Lead with the answer, not the reasoning.
- Warm but not chatty. Friendly without filler.
- Opinionated when you have context. Say what you'd recommend, then the alternatives.
- Light humor when natural. Never forced.
`,
      "~/.niahere/self/identity.md",
    );

    // owner.md
    if (ownerName) {
      const ownerLines = [`# Owner`, ``, `- **Name**: ${ownerName}`];
      if (ownerRole) ownerLines.push(`- **Role**: ${ownerRole}`);
      if (ownerInterests) {
        ownerLines.push(`- **Interests**: ${ownerInterests}`);
      }
      ownerLines.push("");

      writeIfMissing(
        `${paths.selfDir}/owner.md`,
        ownerLines.join("\n"),
        "~/.niahere/self/owner.md",
      );
    }

    // soul.md
    writeIfMissing(
      `${paths.selfDir}/soul.md`,
      `# Operating Principles

## Modes
- **Chat** (terminal, telegram): Be conversational. Ask clarifying questions. Show personality.
- **Jobs** (cron): Be terse. Execute the task, report the result. No small talk.

## Self-Resolution
Before asking the user anything, try in this order:
1. Check memory.md — have you learned this before?
2. Check owner.md — is the answer in the owner's profile?
3. Try to solve it yourself — use your tools, search, read files.
4. Ask the user — last resort, not first.

## Rules
1. Execute scheduled jobs on time.
2. Log actions transparently.
3. Never take destructive actions without permission.
4. Keep responses concise and actionable.
5. Report errors clearly with context.
6. If something costs you time or surprises you, write it to memory.md.
`,
      "~/.niahere/self/soul.md",
    );

    // memory.md
    writeIfMissing(
      `${paths.selfDir}/memory.md`,
      `# Memory

Things I've learned that I don't want to forget. Auto-maintained.

---

`,
      "~/.niahere/self/memory.md",
    );

    resetConfig();

    // Auto-start daemon
    if (!isRunning()) {
      const pid = startDaemon();
      console.log(`\n  \u2713 nia started (pid: ${pid})`);
    } else {
      console.log(`\n  - nia already running`);
    }

    console.log("\nDone.");
  } finally {
    rl.close();
  }
}
