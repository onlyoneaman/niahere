import { existsSync, statSync } from "fs";
import { join } from "path";
import { isRunning, readPid } from "../core/daemon";
import { getConfig, readRawConfig } from "../utils/config";
import { getPaths } from "../utils/paths";
import { errMsg } from "../utils/errors";
import { localTime } from "../utils/time";

type Check = { name: string; status: "ok" | "warn" | "fail"; detail: string };

function push(checks: Check[], name: string, status: Check["status"], detail: string): void {
  checks.push({ name, status, detail });
}

export async function healthCommand(): Promise<void> {
  const checks: Check[] = [];
  const paths = getPaths();

  // 0. Version
  const { version } = await import("../../package.json");
  push(checks, "nia", "ok", "v" + version);

  // 1. Daemon
  const pid = readPid();
  if (isRunning()) {
    push(checks, "daemon", "ok", "running (pid: " + pid + ")");
  } else if (pid) {
    push(checks, "daemon", "fail", "stale pid file (pid: " + pid + ", not running)");
  } else {
    push(checks, "daemon", "warn", "not running");
  }

  // 2. Config
  if (existsSync(paths.config)) {
    const raw = readRawConfig();
    push(checks, "config", "ok", Object.keys(raw).length + " keys loaded");
  } else {
    push(checks, "config", "fail", "missing (" + paths.config + ")");
  }

  // 3. Database
  try {
    const config = getConfig();
    if (!config.database_url || !config.database_url.startsWith("postgres")) {
      push(checks, "database", "fail", 'invalid url: "' + (config.database_url || "(empty)") + '"');
    } else {
      const { checkDbHealth } = await import("./health-db");
      const ok = await checkDbHealth(config.database_url);
      push(checks, "database", ok ? "ok" : "fail", config.database_url.replace(/\/\/.*@/, "//***@"));
    }
  } catch (err) {
    push(checks, "database", "fail", errMsg(err));
  }

  // 4. Channels
  const config = getConfig();
  if (!config.channels.enabled) {
    push(checks, "channels", "warn", "disabled");
  } else {
    const chans: string[] = [];
    if (config.channels.telegram.bot_token) chans.push("telegram");
    if (config.channels.slack.bot_token && config.channels.slack.app_token) chans.push("slack");
    if (chans.length > 0) {
      push(checks, "channels", "ok", "configured: " + chans.join(", "));
    } else {
      push(checks, "channels", "warn", "enabled but no tokens configured");
    }
  }

  // 5. API keys
  const geminiKey = config.gemini_api_key;
  const rawConfig = readRawConfig();
  const openaiKey = typeof rawConfig.openai_api_key === "string" ? rawConfig.openai_api_key : null;
  const apiKeys: string[] = [];
  if (geminiKey) apiKeys.push("gemini");
  if (openaiKey) apiKeys.push("openai");
  push(checks, "api keys", apiKeys.length > 0 ? "ok" : "warn",
    apiKeys.length > 0 ? apiKeys.join(", ") : "none configured");

  // 6. Persona files
  const personaFiles = ["identity.md", "owner.md", "soul.md"];
  const missing = personaFiles.filter((f) => !existsSync(join(paths.selfDir, f)));
  if (missing.length === 0) {
    push(checks, "persona", "ok", "all files present");
  } else {
    push(checks, "persona", "warn", "missing: " + missing.join(", "));
  }

  // 7. Daemon log
  if (existsSync(paths.daemonLog)) {
    const stat = statSync(paths.daemonLog);
    const sizeMb = (stat.size / 1024 / 1024).toFixed(1);
    const lastMod = localTime(stat.mtime);
    push(checks, "logs", stat.size > 100 * 1024 * 1024 ? "warn" : "ok",
      sizeMb + " MB, last write: " + lastMod);
  } else {
    push(checks, "logs", "warn", "no log file");
  }

  // 8. Bun version
  const bunVersion = typeof Bun !== "undefined" ? Bun.version : "unknown";
  push(checks, "bun", "ok", "v" + bunVersion);

  // Output
  const { GREEN, YELLOW, RED, RESET, ICON_PASS, ICON_FAIL, ICON_WARN } = await import("../utils/cli");
  const icons: Record<string, string> = {
    ok: GREEN + ICON_PASS + RESET,
    warn: YELLOW + ICON_WARN + RESET,
    fail: RED + ICON_FAIL + RESET,
  };

  console.log();
  for (const c of checks) {
    console.log("  " + icons[c.status] + " " + c.name.padEnd(12) + " " + c.detail);
  }
  console.log();

  const failCount = checks.filter((c) => c.status === "fail").length;
  if (failCount > 0) process.exit(1);
}
