import { existsSync, statSync } from "fs";
import { join } from "path";
import { getConfig, readRawConfig } from "../utils/config";
import { getPaths } from "../utils/paths";
import { isRunning, readPid } from "../utils/pid";
import { errMsg } from "../utils/errors";
import { localTime } from "../utils/time";
import { withRetry } from "../utils/retry";
import { codexAvailable, codexModelSlugs } from "../agent/catalog";
import { providerHealth } from "../agent/health";
import { IMPLEMENTED, describeRef, planChain, resolveModel, type ModelRef } from "../agent/models";

export type CheckStatus = "ok" | "warn" | "fail";
export type Check = { name: string; status: CheckStatus; detail: string };

/** Past this, the chain is not falling back — it has moved. */
export const FAILOVER_INCIDENT_MS = 60 * 60 * 1000;

/**
 * Failover is meant to be invisible for a blip and impossible to miss for an
 * outage. Nothing distinguished the two, so Nia answered as Codex for sixteen
 * days without a word.
 */
export function auditFailover(streakMs: number | null, server: string | null): Check {
  if (streakMs === null) return { name: "failover", status: "ok", detail: "primary serving" };
  const hours = streakMs / 3_600_000;
  const since = hours >= 1 ? `${hours.toFixed(1)}h` : `${Math.round(streakMs / 60_000)}m`;
  const who = server ? ` (${server} covering)` : "";
  return streakMs >= FAILOVER_INCIDENT_MS
    ? { name: "failover", status: "fail", detail: `primary has not served for ${since}${who}` }
    : { name: "failover", status: "warn", detail: `failed over ${since} ago${who}` };
}

/**
 * A model retired upstream still parses, still resolves to a provider, and still
 * takes a full turn to fail. Judge the configured names against what the
 * provider will actually accept so a retirement reads as a warning here rather
 * than as an outage later.
 */
export function auditModelPlan(
  configured: string[],
  plan: ModelRef[],
  codex: { available: boolean; slugs: string[] | null },
): Check {
  const problems: string[] = [];
  let primaryBroken = false;

  configured.forEach((name, i) => {
    const ref = resolveModel(name);
    let problem: string | null = null;
    if (!IMPLEMENTED.includes(ref.provider)) {
      problem = `${name}: no ${ref.provider} adapter`;
    } else if (ref.provider === "codex" && !codex.available) {
      problem = `${name}: codex CLI not installed`;
    } else if (ref.provider === "codex" && ref.model && codex.slugs && !codex.slugs.includes(ref.model)) {
      problem = `${name}: retired — codex no longer offers it`;
    }
    if (problem) {
      problems.push(problem);
      if (i === 0) primaryBroken = true;
    }
  });

  const chain = plan.map(describeRef).join(" → ") || "(empty)";
  if (problems.length === 0) return { name: "models", status: "ok", detail: chain };
  return {
    name: "models",
    status: primaryBroken ? "fail" : "warn",
    detail: `${problems.join("; ")} — chain: ${chain}`,
  };
}

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
    checks.push({
      name: "daemon",
      status: "ok",
      detail: "running (pid: " + pid + ")",
    });
  } else if (pid) {
    checks.push({
      name: "daemon",
      status: "fail",
      detail: "stale pid file (pid: " + pid + ", not running)",
    });
  } else {
    checks.push({ name: "daemon", status: "warn", detail: "not running" });
  }

  // Config
  if (existsSync(paths.config)) {
    const raw = readRawConfig();
    checks.push({
      name: "config",
      status: "ok",
      detail: Object.keys(raw).length + " keys loaded",
    });
  } else {
    checks.push({
      name: "config",
      status: "fail",
      detail: "missing (" + paths.config + ")",
    });
  }

  // Database
  try {
    if (!config.database_url || !config.database_url.startsWith("postgres")) {
      checks.push({
        name: "database",
        status: "fail",
        detail: 'invalid url: "' + (config.database_url || "(empty)") + '"',
      });
    } else {
      const { checkDbHealth } = await import("../commands/health-db");
      const ok = await checkDbHealth(config.database_url);
      checks.push({
        name: "database",
        status: ok ? "ok" : "fail",
        detail: ok ? "connected" : "unreachable",
      });
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
        const resp = await withRetry(() =>
          fetch(`https://api.telegram.org/bot${tgToken}/getMe`, {
            signal: AbortSignal.timeout(5000),
          }),
        );
        const data = (await resp.json()) as { ok: boolean };
        results.push(data.ok ? "telegram: connected" : "telegram: auth failed");
        if (!data.ok)
          checks.push({
            name: "telegram",
            status: "fail",
            detail: "auth failed",
          });
      } catch {
        results.push("telegram: unreachable");
        checks.push({
          name: "telegram",
          status: "warn",
          detail: "unreachable",
        });
      }
    }

    // Slack
    const slToken = config.channels.slack.bot_token;
    if (slToken) {
      try {
        const resp = await withRetry(() =>
          fetch("https://slack.com/api/auth.test", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${slToken}`,
              "Content-Type": "application/json",
            },
            signal: AbortSignal.timeout(5000),
          }),
        );
        const data = (await resp.json()) as { ok: boolean; error?: string };
        results.push(data.ok ? "slack: connected" : `slack: ${data.error || "auth failed"}`);
        if (!data.ok)
          checks.push({
            name: "slack",
            status: "fail",
            detail: data.error || "auth failed",
          });
      } catch {
        results.push("slack: unreachable");
        checks.push({ name: "slack", status: "warn", detail: "unreachable" });
      }
    }

    if (results.length === 0) {
      checks.push({
        name: "channels",
        status: "warn",
        detail: "enabled but no tokens configured",
      });
    } else {
      const allOk = results.every((r) => r.includes("connected"));
      checks.push({
        name: "channels",
        status: allOk ? "ok" : "warn",
        detail: results.join(", "),
      });
    }
  }

  // Model chain
  const codex = codexAvailable();
  const plan = planChain(config.model, config.fallback_models, {
    available: (p) => (p === "codex" ? codex : p === "claude"),
  });
  const needsCatalog = plan.some((r) => r.provider === "codex" && r.model);
  checks.push(
    auditModelPlan([config.model, ...config.fallback_models], plan, {
      available: codex,
      slugs: needsCatalog && codex ? await codexModelSlugs() : null,
    }),
  );

  checks.push(auditFailover(providerHealth.fallbackStreakMs(), providerHealth.lastServer()));

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
