import * as readline from "readline";
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "fs";
import { resolve } from "path";
import { homedir } from "os";
import { getNiaHome, getPaths } from "../utils/paths";
import { resetConfig } from "../utils/config";
import { runMigrations } from "../db/migrate";
import { closeDb } from "../db/connection";
import { startDaemon, isRunning } from "../core/daemon";
import { errMsg } from "../utils/errors";
import yaml from "js-yaml";

const DEFAULTS_DIR = resolve(import.meta.dir, "../../defaults/self");
const SKILL_ASSETS_DIR = resolve(import.meta.dir, "../../skills/nia-image/assets");
const GENERATE_SCRIPT = resolve(import.meta.dir, "../../skills/nia-image/scripts/generate_image.py");

function ask(rl: readline.Interface, question: string, defaultValue?: string): Promise<string> {
  const suffix = defaultValue ? ` [${defaultValue}]` : "";
  return new Promise((resolve) => {
    rl.question(`${question}${suffix}: `, (answer) => {
      resolve(answer.trim() || defaultValue || "");
    });
  });
}

function getShellRc(): string {
  const shell = process.env.SHELL || "";
  if (shell.endsWith("zsh")) return resolve(homedir(), ".zshrc");
  if (shell.endsWith("bash")) {
    const bashProfile = resolve(homedir(), ".bash_profile");
    if (existsSync(bashProfile)) return bashProfile;
    return resolve(homedir(), ".bashrc");
  }
  return resolve(homedir(), ".profile");
}

const BEADS_EXPORT_LINE = (dir: string) => `export BEADS_DIR="${dir.replace(homedir(), "$HOME")}/.beads"`;

async function offerBeadsShellExport(rl: readline.Interface, beadsDir: string): Promise<void> {
  const rcFile = getShellRc();
  const exportLine = BEADS_EXPORT_LINE(beadsDir);

  // Check if already exported
  if (existsSync(rcFile)) {
    const content = readFileSync(rcFile, "utf8");
    if (content.includes("BEADS_DIR")) {
      return; // already configured
    }
  }

  const answer = await ask(rl, `\nAdd BEADS_DIR to ${rcFile.replace(homedir(), "~")} so 'bd' works globally? (y/n)`, "y");
  if (answer.toLowerCase() !== "y") return;

  appendFileSync(rcFile, `\n# Beads global task DB\n${exportLine}\n`);
  console.log(`  \u2713 added BEADS_DIR to ${rcFile.replace(homedir(), "~")}`);
  console.log(`  Run 'source ${rcFile.replace(homedir(), "~")}' or open a new terminal.`);
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
    const { DEFAULT_DATABASE_URL } = await import("../constants");
    const defaultDb = (existing.database_url as string) || DEFAULT_DATABASE_URL;
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
    const exCh = (existing.channels || {}) as Record<string, unknown>;
    const exTg = (exCh.telegram || {}) as Record<string, unknown>;
    const exSl = (exCh.slack || {}) as Record<string, unknown>;

    let telegramToken = "";
    let telegramChatId: number | null = (exTg.chat_id as number) || null;
    let telegramOpen = exTg.open === true;

    const existingToken = (exTg.bot_token as string) || "";

    if (existingToken) {
      const masked = `...${existingToken.slice(-6)}`;
      const reconfigure = await ask(rl, `\nTelegram: configured (${masked}). Reconfigure? (y/n)`, "n");
      if (reconfigure.toLowerCase() === "y") {
        const tokenInput = await ask(rl, "Bot token", "");
        telegramToken = tokenInput || existingToken;
        const openDefault = telegramOpen ? "y" : "n";
        const openInput = await ask(rl, "Allow anyone to message? (y/n)", openDefault);
        telegramOpen = openInput.toLowerCase() === "y";
      } else {
        telegramToken = existingToken;
      }
    } else {
      const setupTelegram = await ask(rl, "\nSet up Telegram? (y/n)", "n");
      if (setupTelegram.toLowerCase() === "y") {
        telegramToken = await ask(rl, "Bot token", "");
        if (telegramToken) {
          const openInput = await ask(rl, "Allow anyone to message? (y/n)", "n");
          telegramOpen = openInput.toLowerCase() === "y";
        }
      }
    }

    // Slack
    let slackBotToken = "";
    let slackAppToken = "";
    let slackChannelId = (exSl.channel_id as string) || "";

    const existingSlackBot = (exSl.bot_token as string) || "";

    if (existingSlackBot) {
      const masked = `...${existingSlackBot.slice(-6)}`;
      const reconfigure = await ask(rl, `\nSlack: configured (${masked}). Reconfigure? (y/n)`, "n");
      if (reconfigure.toLowerCase() === "y") {
        const botInput = await ask(rl, "Bot token (xoxb-...)", "");
        slackBotToken = botInput || existingSlackBot;
        const existingSlackApp = (exSl.app_token as string) || "";
        const appInput = await ask(rl, "App token (xapp-...)", "");
        slackAppToken = appInput || existingSlackApp;
        if (slackBotToken && slackAppToken) {
          slackChannelId = await ask(rl, "Default channel ID for outbound messages (optional)", slackChannelId);
        }
      } else {
        slackBotToken = existingSlackBot;
        slackAppToken = (exSl.app_token as string) || "";
        slackChannelId = (exSl.channel_id as string) || "";
      }
    } else {
      const setupSlack = await ask(rl, "\nSet up Slack? (y/n)", "n");
      if (setupSlack.toLowerCase() === "y") {
        // Read manifest and build the create-app URL
        const manifestPath = resolve(import.meta.dir, "../../defaults/channels/slack-manifest.json");
        const manifest = readFileSync(manifestPath, "utf8");
        const createUrl = `https://api.slack.com/apps?new_app=1&manifest_json=${encodeURIComponent(manifest)}`;

        console.log("\n  Opening Slack app creation page...");
        Bun.spawn(["open", createUrl], { stdio: ["ignore", "ignore", "ignore"] });
        console.log("  1. Click 'Create' to create the app");
        console.log("  2. Go to 'OAuth & Permissions' → Install to workspace → copy Bot Token (xoxb-...)");
        console.log("  3. Go to 'Basic Information' → 'App-Level Tokens' → create one with connections:write → copy (xapp-...)\n");

        slackBotToken = await ask(rl, "Bot token (xoxb-...)", "");
        slackAppToken = await ask(rl, "App token (xapp-...)", "");

        if (slackBotToken && slackAppToken) {
          slackChannelId = await ask(rl, "Default channel ID for outbound messages (optional)", "");
        }
      }
    }

    // Gemini API key (for image generation)
    let geminiApiKey = "";
    const existingGemini = (existing.gemini_api_key as string) || "";

    if (existingGemini) {
      const masked = `...${existingGemini.slice(-6)}`;
      const reconfigure = await ask(rl, `\nGemini API: configured (${masked}). Reconfigure? (y/n)`, "n");
      if (reconfigure.toLowerCase() === "y") {
        geminiApiKey = await ask(rl, "Gemini API key", "") || existingGemini;
      } else {
        geminiApiKey = existingGemini;
      }
    } else {
      const setupGemini = await ask(rl, "\nSet up Gemini API key? (for image generation) (y/n)", "n");
      if (setupGemini.toLowerCase() === "y") {
        geminiApiKey = await ask(rl, "API key (from https://aistudio.google.com/apikey)", "");
      }
    }

    // Beads task manager
    const bdInstalled = await Bun.spawn(["which", "bd"], { stdout: "pipe", stderr: "pipe" }).exited === 0;
    const beadsInitialized = existsSync(`${paths.beadsDir}/.beads`);

    if (bdInstalled && beadsInitialized) {
      console.log("\nBeads: installed and initialized.");
      await offerBeadsShellExport(rl, paths.beadsDir);
    } else if (bdInstalled && !beadsInitialized) {
      const initBeads = await ask(rl, "\nBeads (bd) found but not initialized. Set up global task DB? (y/n)", "y");
      if (initBeads.toLowerCase() === "y") {
        mkdirSync(paths.beadsDir, { recursive: true });
        const initProc = Bun.spawn(["bd", "init"], { cwd: paths.beadsDir, stdout: "pipe", stderr: "pipe" });
        const exitCode = await initProc.exited;
        if (exitCode === 0) {
          console.log(`  \u2713 initialized beads at ${paths.beadsDir}`);
          await offerBeadsShellExport(rl, paths.beadsDir);
        } else {
          const stderr = await new Response(initProc.stderr).text();
          console.log(`  \u2717 bd init failed: ${stderr.trim()}`);
        }
      }
    } else {
      const installBeads = await ask(rl, "\nInstall Beads task manager? (y/n)", "n");
      if (installBeads.toLowerCase() === "y") {
        console.log("  Installing...");
        const npmProc = Bun.spawn(["npm", "install", "-g", "@beads/bd"], { stdout: "pipe", stderr: "pipe" });
        let installExit = await npmProc.exited;

        if (installExit !== 0 && process.platform === "darwin") {
          console.log("  npm failed, trying brew...");
          const brewProc = Bun.spawn(["brew", "install", "beads"], { stdout: "pipe", stderr: "pipe" });
          installExit = await brewProc.exited;
        }

        if (installExit === 0) {
          console.log("  \u2713 beads installed");
          mkdirSync(paths.beadsDir, { recursive: true });
          const initProc = Bun.spawn(["bd", "init"], { cwd: paths.beadsDir, stdout: "pipe", stderr: "pipe" });
          if (await initProc.exited === 0) {
            console.log(`  \u2713 initialized beads at ${paths.beadsDir}`);
            await offerBeadsShellExport(rl, paths.beadsDir);
          }
        } else {
          console.log("  \u2717 install failed. You can install manually: npm install -g @beads/bd");
        }
      }
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

    // Active hours
    const existingHours = existing.active_hours as Record<string, string> | undefined;
    const defaultStart = existingHours?.start || "00:00";
    const defaultEnd = existingHours?.end || "23:59";
    console.log("\nActive hours (jobs run only during this window, crons run 24/7):");
    const activeStart = await ask(rl, "Start (HH:MM)", defaultStart);
    const activeEnd = await ask(rl, "End (HH:MM)", defaultEnd);

    // Agent name
    const agentName = await ask(rl, "\nAgent name", readExistingName("identity.md") || "nia");

    // Visual identity
    const imagesDir = `${home}/images`;
    mkdirSync(imagesDir, { recursive: true });
    const hasUserReference = existsSync(`${imagesDir}/reference.png`);
    const hasDefaultReference = existsSync(`${SKILL_ASSETS_DIR}/nia-reference.jpg`);

    if (geminiApiKey && !hasUserReference) {
      const setupVisual = await ask(rl, "\nGenerate a visual identity for your agent? (y/n)", "y");
      if (setupVisual.toLowerCase() === "y") {
        const visualChoice = await ask(rl, "Describe what your agent looks like (or press enter for default)", "");

        if (visualChoice) {
          // User provided a description — generate from scratch
          console.log("  Generating reference image from description...");
          const prompt = `Ultra photorealistic portrait: ${visualChoice}. Natural skin texture, DSLR quality, 8k, hyper-detailed.`;
          const proc = Bun.spawn([
            "python3", GENERATE_SCRIPT,
            "--no-reference",
            "--api-key", geminiApiKey,
            "--aspect-ratio", "9:16",
            "--prompt", prompt,
            "--output", `${imagesDir}/reference.png`,
          ], { stdout: "pipe", stderr: "pipe" });
          const exitCode = await proc.exited;
          if (exitCode === 0) {
            console.log(`  \u2713 generated reference image at ${imagesDir}/reference.png`);
            // Also generate a profile picture
            console.log("  Generating profile picture...");
            const profileProc = Bun.spawn([
              "python3", GENERATE_SCRIPT,
              "--reference", `${imagesDir}/reference.png`,
              "--api-key", geminiApiKey,
              "--aspect-ratio", "1:1",
              "--prompt", `Photorealistic close-up portrait of the same person from the reference. Warm slight smile, direct eye contact, soft ambient side lighting, creamy bokeh background, 85mm f/1.8, shallow depth of field. Same face, same style, natural skin texture, DSLR quality, hyper-detailed.`,
              "--output", `${imagesDir}/profile.png`,
            ], { stdout: "pipe", stderr: "pipe" });
            if (await profileProc.exited === 0) {
              console.log(`  \u2713 generated profile picture at ${imagesDir}/profile.png`);
            }
          } else {
            const stderr = await new Response(proc.stderr).text();
            console.log(`  \u2717 image generation failed: ${stderr.trim().slice(0, 200)}`);
          }
        } else if (hasDefaultReference) {
          // No description — copy defaults
          const { copyFileSync } = await import("fs");
          copyFileSync(`${SKILL_ASSETS_DIR}/nia-reference.jpg`, `${imagesDir}/reference.png`);
          console.log(`  \u2713 copied default reference image`);
          if (existsSync(`${SKILL_ASSETS_DIR}/nia-profile.jpg`)) {
            copyFileSync(`${SKILL_ASSETS_DIR}/nia-profile.jpg`, `${imagesDir}/profile.png`);
            console.log(`  \u2713 copied default profile picture`);
          }
        }
      }
    } else if (hasUserReference) {
      console.log("\nVisual identity: already set up.");
    }

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
      active_hours: { start: activeStart, end: activeEnd },
    };

    if (geminiApiKey) {
      config.gemini_api_key = geminiApiKey;
    }

    // Channels config (nested)
    const channels: Record<string, unknown> = {};
    if (telegramToken) {
      const tg: Record<string, unknown> = { bot_token: telegramToken, open: telegramOpen };
      if (telegramChatId) tg.chat_id = telegramChatId;
      channels.telegram = tg;
    }
    if (slackBotToken && slackAppToken) {
      const sl: Record<string, unknown> = { bot_token: slackBotToken, app_token: slackAppToken };
      if (slackChannelId) sl.channel_id = slackChannelId;
      channels.slack = sl;
    }
    if (slackBotToken && !telegramToken) {
      channels.default = "slack";
    }
    if (Object.keys(channels).length > 0) {
      config.channels = channels;
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
