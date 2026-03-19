import { existsSync, readFileSync } from "fs";
import yaml from "js-yaml";
import { getPaths } from "../utils/paths";
import { ICON_PASS as PASS, ICON_FAIL as FAIL, ICON_WARN as WARN } from "../utils/cli";

interface Result {
  ok: boolean;
  messages: string[];
}

function check(label: string, fn: () => string | null): { icon: string; label: string; detail?: string } {
  const err = fn();
  if (err) return { icon: FAIL, label, detail: err };
  return { icon: PASS, label };
}

function warn(label: string, detail: string): { icon: string; label: string; detail?: string } {
  return { icon: WARN, label, detail };
}

export function validateConfig(): Result {
  const { config: configPath } = getPaths();
  const messages: string[] = [];
  let ok = true;

  // File exists
  if (!existsSync(configPath)) {
    return { ok: false, messages: [`${FAIL} config.yaml not found at ${configPath}`] };
  }

  // Valid YAML
  let raw: Record<string, unknown>;
  try {
    const parsed = yaml.load(readFileSync(configPath, "utf8"));
    if (!parsed || typeof parsed !== "object") {
      return { ok: false, messages: [`${FAIL} config.yaml is empty or not an object`] };
    }
    raw = parsed as Record<string, unknown>;
    messages.push(`${PASS} valid YAML`);
  } catch (err) {
    return { ok: false, messages: [`${FAIL} invalid YAML: ${(err as Error).message}`] };
  }

  // Timezone
  if (raw.timezone) {
    try {
      Intl.DateTimeFormat(undefined, { timeZone: raw.timezone as string });
      messages.push(`${PASS} timezone: ${raw.timezone}`);
    } catch {
      messages.push(`${FAIL} invalid timezone: ${raw.timezone}`);
      ok = false;
    }
  }

  // Active hours
  const ah = raw.active_hours as Record<string, string> | undefined;
  if (ah) {
    const timeRe = /^\d{2}:\d{2}$/;
    if (ah.start && !timeRe.test(ah.start)) {
      messages.push(`${FAIL} active_hours.start invalid: "${ah.start}" (expected HH:MM)`);
      ok = false;
    } else if (ah.start) {
      messages.push(`${PASS} active_hours: ${ah.start}–${ah.end || "?"}`);
    }
    if (ah.end && !timeRe.test(ah.end)) {
      messages.push(`${FAIL} active_hours.end invalid: "${ah.end}" (expected HH:MM)`);
      ok = false;
    }
  }

  // Database URL
  const dbUrl = (process.env.DATABASE_URL || raw.database_url) as string | undefined;
  if (dbUrl && dbUrl.startsWith("postgres")) {
    messages.push(`${PASS} database_url set`);
  } else if (!dbUrl) {
    messages.push(`${WARN} database_url not set (will use default)`);
  }

  // Runner
  const runner = raw.runner as string | undefined;
  if (runner && runner !== "claude" && runner !== "codex") {
    messages.push(`${FAIL} runner must be "claude" or "codex", got "${runner}"`);
    ok = false;
  } else if (runner) {
    messages.push(`${PASS} runner: ${runner}`);
  }

  // Channels
  const ch = raw.channels as Record<string, unknown> | undefined;
  if (ch) {
    // Telegram
    const tg = ch.telegram as Record<string, unknown> | undefined;
    if (tg) {
      if (tg.bot_token) {
        messages.push(`${PASS} telegram.bot_token set`);
      } else {
        messages.push(`${WARN} telegram.bot_token missing — telegram won't start`);
      }
    }

    // Slack
    const sl = ch.slack as Record<string, unknown> | undefined;
    if (sl) {
      if (!sl.bot_token) {
        messages.push(`${WARN} slack.bot_token missing — slack won't start`);
      } else {
        messages.push(`${PASS} slack.bot_token set`);
      }
      if (!sl.app_token) {
        messages.push(`${WARN} slack.app_token missing — slack won't start (Socket Mode requires app_token)`);
      } else {
        messages.push(`${PASS} slack.app_token set`);
      }

      // Watch channels
      const watch = sl.watch as Record<string, unknown> | undefined;
      if (watch) {
        for (const [key, val] of Object.entries(watch)) {
          if (!val || typeof val !== "object") {
            messages.push(`${FAIL} slack.watch.${key}: must be an object with "behavior" field`);
            ok = false;
            continue;
          }
          const behavior = (val as Record<string, unknown>).behavior;
          if (typeof behavior !== "string" || !behavior.trim()) {
            messages.push(`${FAIL} slack.watch.${key}: missing "behavior" string`);
            ok = false;
            continue;
          }
          if (key.includes("#")) {
            const enabled = (val as Record<string, unknown>).enabled !== false;
            messages.push(`${enabled ? PASS : WARN} slack.watch: ${key}${enabled ? "" : " (disabled)"}`);
          } else {
            messages.push(`${FAIL} slack.watch.${key}: must use "channel_id#${key}" format`);
            ok = false;
          }
        }
      }
    }

    // Unknown channel keys
    const knownChannelKeys = new Set(["enabled", "default", "telegram", "slack"]);
    for (const key of Object.keys(ch)) {
      if (!knownChannelKeys.has(key)) {
        messages.push(`${WARN} unknown channel key: "channels.${key}" — did you mean "channels.slack"?`);
      }
    }
  }

  return { ok, messages };
}
