import * as readline from "readline";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import { getNiaHome, getPaths } from "../utils/paths";
import { resetConfig } from "../utils/config";
import { runMigrations } from "../db/migrate";
import { closeDb } from "../db/connection";
import { startDaemon, isRunning } from "../core/daemon";
import { errMsg } from "../utils/errors";
import yaml from "js-yaml";

const DEFAULTS_DIR = resolve(import.meta.dir, "../../defaults/self");

function ask(rl: readline.Interface, question: string, defaultValue?: string): Promise<string> {
  const suffix = defaultValue ? ` [${defaultValue}]` : "";
  return new Promise((resolve) => {
    rl.question(`${question}${suffix}: `, (answer) => {
      resolve(answer.trim() || defaultValue || "");
    });
  });
}

function loadTemplate(name: string, vars: Record<string, string> = {}): string {
  const content = readFileSync(resolve(DEFAULTS_DIR, name), "utf8");
  return content.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? "");
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
      const msg = errMsg(err);
      console.log(`  \u2717 could not connect: ${msg}`);
      console.log(`  (you can fix this later in ${paths.config})\n`);
    }
    delete process.env.DATABASE_URL;

    // Telegram
    const existingToken = (existing.telegram_bot_token as string) || "";
    const maskedToken = existingToken ? `${existingToken.slice(0, 4)}…${existingToken.slice(-4)}` : "";
    const tokenInput = await ask(rl, "Telegram bot token (Enter to skip)", maskedToken);
    const telegramToken = tokenInput === maskedToken ? existingToken : tokenInput;

    let telegramChatId: number | null = (existing.telegram_chat_id as number) || null;
    if (telegramToken) {
      const defaultChatId = telegramChatId ? String(telegramChatId) : "";
      const chatIdStr = await ask(rl, "Telegram chat ID (Enter to skip)", defaultChatId);
      if (chatIdStr) telegramChatId = Number(chatIdStr);
    }

    // Read existing self files for defaults
    function readExisting(file: string, field: string): string {
      const filePath = `${paths.selfDir}/${file}`;
      if (!existsSync(filePath)) return "";
      const content = readFileSync(filePath, "utf8");
      const match = content.match(new RegExp(`\\*\\*${field}\\*\\*:\\s*(.+)$`, "m"));
      return match?.[1]?.trim() || "";
    }

    function readExistingName(file: string): string {
      const filePath = `${paths.selfDir}/${file}`;
      if (!existsSync(filePath)) return "";
      const match = readFileSync(filePath, "utf8").match(/^#\s+(.+)$/m);
      return match?.[1]?.trim() || "";
    }

    // Owner info
    console.log("\nAbout you:");
    const ownerName = await ask(rl, "Your name", readExisting("owner.md", "Name"));
    const ownerRole = await ask(rl, "What do you do?", readExisting("owner.md", "Role"));
    const ownerLocation = await ask(rl, "Location", readExisting("owner.md", "Location"));
    const ownerInterests = await ask(rl, "Interests", readExisting("owner.md", "Interests"));

    // Agent name
    const agentName = await ask(rl, "\nAgent name", readExistingName("identity.md") || "nia");

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
    console.log(`\n  \u2713 wrote ${paths.config}`);

    // --- Self files (from defaults/self/ templates) ---
    const vars = { agentName, ownerName, ownerRole, ownerLocation, ownerInterests };
    const selfFile = (name: string) => `${paths.selfDir}/${name}`;

    writeFileSync(selfFile("identity.md"), loadTemplate("identity.md", vars));
    console.log(`  \u2713 wrote ${selfFile("identity.md")}`);

    if (ownerName) {
      let ownerContent = loadTemplate("owner.md", vars);
      ownerContent = ownerContent.split("\n").filter((l) => !l.match(/\*\*\w+\*\*:\s*$/)).join("\n");
      writeFileSync(selfFile("owner.md"), ownerContent);
      console.log(`  \u2713 wrote ${selfFile("owner.md")}`);
    }

    // Soul and memory — only create if missing (user may have customized)
    writeIfMissing(selfFile("soul.md"), loadTemplate("soul.md"), selfFile("soul.md"));
    writeIfMissing(selfFile("memory.md"), loadTemplate("memory.md"), selfFile("memory.md"));

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
