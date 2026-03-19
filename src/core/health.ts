import { existsSync, statSync } from "fs";
import { join } from "path";
import { getConfig, readRawConfig } from "../utils/config";
import { getPaths } from "../utils/paths";
import { isRunning, readPid } from "./daemon";
import { errMsg } from "../utils/errors";
import { localTime } from "../utils/time";

export type CheckStatus = "ok" | "warn" | "fail";
export type Check = { name: string; status: CheckStatus; detail: string };

/** Run all health checks. Returns structured results usable by CLI and alive monitor. */
export async function runHealthChecks(): Promise<Check[]> {
  const checks: Check[] = [];
  const paths = getPaths();
  const config = getConfig();

  // Version
  const { version } = await import("../../package.json");
  checks.push({ name: "nia", status: "ok", detail: "v" + version });

  // Daemon
  const pid = readPid();
  if (isRunning()) {
    checks.push({ name: "daemon", status: "ok", detail: "running (pid: " + pid + ")" });
  } else if (pid) {
    checks.push({ name: "daemon", status: "fail", detail: "stale pid file (pid: " + pid + ", not running)" });
  } else {
    checks.push({ name: "daemon", status: "warn", detail: "not running" });
  }

  // Config
  if (existsSync(paths.config)) {
    const raw = readRawConfig();
    checks.push({ name: "config", status: "ok", detail: Object.keys(raw).length + " keys loaded" });
  } else {
    checks.push({ name: "config", status: "fail", detail: "missing (" + paths.config + ")" });
  }

  // Database
  try {
    if (!config.database_url || !config.database_url.startsWith("postgres")) {
      checks.push({ name: "database", status: "fail", detail: 'invalid url: "' + (config.database_url || "(empty)") + '"' });
    } else {
      const { checkDbHealth } = await import("../commands/health-db");
      const ok = await checkDbHealth(config.database_url);
      checks.push({ name: "database", status: ok ? "ok" : "fail", detail: ok ? "connected" : "unreachable" });
    }
  } catch (err) {
    checks.push({ name: "database", status: "fail", detail: errMsg(err) });
  }

  // Channels — check actual connectivity, not just config
  if (!config.channels.enabled) {
    checks.push({ name: "channels", status: "warn", detail: "disabled" });
  } else {
    const results: string[] = [];

    // Telegram
    const tgToken = config.channels.telegram.bot_token;
    if (tgToken) {
      try {
        const resp = await fetch(`https://api.telegram.org/bot${tgToken}/getMe`);
        const data = await resp.json() as { ok: boolean };
        results.push(data.ok ? "telegram: connected" : "telegram: auth failed");
        if (!data.ok) checks.push({ name: "telegram", status: "fail", detail: "auth failed" });
      } catch {
        results.push("telegram: unreachable");
        checks.push({ name: "telegram", status: "fail", detail: "unreachable" });
      }
    }

    // Slack
    const slToken = config.channels.slack.bot_token;
    if (slToken) {
      try {
        const resp = await fetch("https://slack.com/api/auth.test", {
          method: "POST",
          headers: { Authorization: `Bearer ${slToken}`, "Content-Type": "application/json" },
        });
        const data = await resp.json() as { ok: boolean; error?: string };
        results.push(data.ok ? "slack: connected" : `slack: ${data.error || "auth failed"}`);
        if (!data.ok) checks.push({ name: "slack", status: "fail", detail: data.error || "auth failed" });
      } catch {
        results.push("slack: unreachable");
        checks.push({ name: "slack", status: "fail", detail: "unreachable" });
      }
    }

    if (results.length === 0) {
      checks.push({ name: "channels", status: "warn", detail: "enabled but no tokens configured" });
    } else {
      const allOk = results.every((r) => r.includes("connected"));
      checks.push({ name: "channels", status: allOk ? "ok" : "warn", detail: results.join(", ") });
    }
  }

  // API keys
  const geminiKey = config.gemini_api_key;
  const rawConfig = readRawConfig();
  const openaiKey = typeof rawConfig.openai_api_key === "string" ? rawConfig.openai_api_key : null;
  const apiKeys: string[] = [];
  if (geminiKey) apiKeys.push("gemini");
  if (openaiKey) apiKeys.push("openai");
  checks.push({
    name: "api keys",
    status: apiKeys.length > 0 ? "ok" : "warn",
    detail: apiKeys.length > 0 ? apiKeys.join(", ") : "none configured",
  });

  // Persona files
  const personaFiles = ["identity.md", "owner.md", "soul.md"];
  const missing = personaFiles.filter((f) => !existsSync(join(paths.selfDir, f)));
  checks.push({
    name: "persona",
    status: missing.length === 0 ? "ok" : "warn",
    detail: missing.length === 0 ? "all files present" : "missing: " + missing.join(", "),
  });

  // Daemon log
  if (existsSync(paths.daemonLog)) {
    const stat = statSync(paths.daemonLog);
    const sizeMb = (stat.size / 1024 / 1024).toFixed(1);
    const lastMod = localTime(stat.mtime);
    checks.push({
      name: "logs",
      status: stat.size > 100 * 1024 * 1024 ? "warn" : "ok",
      detail: sizeMb + " MB, last write: " + lastMod,
    });
  } else {
    checks.push({ name: "logs", status: "warn", detail: "no log file" });
  }

  // Bun version
  const bunVersion = typeof Bun !== "undefined" ? Bun.version : "unknown";
  checks.push({ name: "bun", status: "ok", detail: "v" + bunVersion });

  return checks;
}

/** Quick check — returns just the failures. Used by alive monitor. */
export async function getFailures(): Promise<Check[]> {
  const checks = await runHealthChecks();
  return checks.filter((c) => c.status === "fail");
}
