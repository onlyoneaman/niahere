import * as readline from "readline";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { getNiaHome, getPaths } from "../utils/paths";
import { resetConfig } from "../utils/config";
import { runMigrations } from "../db/migrate";
import { closeDb } from "../db/connection";
import yaml from "js-yaml";

function ask(rl: readline.Interface, question: string, defaultValue?: string): Promise<string> {
  const suffix = defaultValue ? ` [${defaultValue}]` : "";
  return new Promise((resolve) => {
    rl.question(`${question}${suffix}: `, (answer) => {
      resolve(answer.trim() || defaultValue || "");
    });
  });
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

    // Agent name
    const defaultName = "nia";
    const agentName = await ask(rl, "Agent name", defaultName);

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

    // Write identity.md if it doesn't exist
    const identityPath = `${paths.selfDir}/identity.md`;
    if (!existsSync(identityPath)) {
      writeFileSync(
        identityPath,
        `You are ${agentName}, a personal AI assistant.\n`,
      );
      console.log(`  \u2713 created ~/.niahere/self/identity.md`);
    } else {
      console.log(`  - ~/.niahere/self/identity.md already exists, skipping`);
    }

    resetConfig();

    console.log("\nDone. Run `nia start` to launch.");
  } finally {
    rl.close();
  }
}
