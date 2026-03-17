import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import yaml from "js-yaml";
import { getPaths } from "./paths";
import { log } from "./log";
import { DEFAULT_DATABASE_URL } from "../constants";
import type { Config } from "../types";

const TIME_RE = /^\d{2}:\d{2}$/;

const DEFAULTS: Config = {
  model: "default",
  timezone: process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone,
  activeHours: { start: "00:00", end: "23:59" },
  database_url: DEFAULT_DATABASE_URL,
  log_level: "info",
  gemini_api_key: null,
  channels: {
    enabled: true,
    default: "telegram",
    telegram: { bot_token: null, chat_id: null, open: false },
    slack: { bot_token: null, app_token: null, channel_id: null, dm_user_id: null, bot_user_id: null, bot_name: null, workspace: null, workspace_id: null, workspace_url: null },
  },
};

let _config: Config | null = null;

export function getConfig(): Config {
  if (!_config) _config = loadConfig();
  return _config;
}

export function resetConfig(): void {
  _config = null;
}

export function loadConfig(): Config {
  const paths = getPaths();

  let raw: Record<string, unknown> | null = null;

  if (existsSync(paths.config)) {
    try {
      raw = yaml.load(readFileSync(paths.config, "utf8")) as Record<string, unknown> | null;
    } catch (err) {
      log.warn({ err, path: paths.config }, "failed to parse config.yaml, using defaults");
    }
  }

  if (!raw || typeof raw !== "object") {
    raw = {};
  }

  // Model
  const model = typeof raw.model === "string" ? raw.model : DEFAULTS.model;

  // Timezone
  let timezone = DEFAULTS.timezone;
  if (typeof raw.timezone === "string") {
    try {
      Intl.DateTimeFormat(undefined, { timeZone: raw.timezone });
      timezone = raw.timezone;
    } catch {
      log.warn({ timezone: raw.timezone }, "invalid timezone in config.yaml, using system default");
    }
  }

  // Active hours
  const activeHours = raw.active_hours as Record<string, string> | undefined;
  let start = activeHours?.start || DEFAULTS.activeHours.start;
  let end = activeHours?.end || DEFAULTS.activeHours.end;
  if (!TIME_RE.test(start) || !TIME_RE.test(end)) {
    log.warn({ start, end }, "invalid active_hours format (expected HH:MM), using defaults");
    start = DEFAULTS.activeHours.start;
    end = DEFAULTS.activeHours.end;
  }

  // Database URL — env var overrides config
  const database_url =
    process.env.DATABASE_URL ||
    (typeof raw.database_url === "string" ? raw.database_url : DEFAULTS.database_url);

  // Log level — env var overrides config
  const log_level =
    process.env.LOG_LEVEL ||
    (typeof raw.log_level === "string" ? raw.log_level : DEFAULTS.log_level);

  // Gemini API key — env var overrides config
  const gemini_api_key =
    process.env.GEMINI_API_KEY ||
    (typeof raw.gemini_api_key === "string" ? raw.gemini_api_key : null);

  // --- Channels (nested under `channels:` in yaml) ---
  const ch = (raw.channels || {}) as Record<string, unknown>;
  const chTg = (ch.telegram || {}) as Record<string, unknown>;
  const chSl = (ch.slack || {}) as Record<string, unknown>;

  const channelsEnabled = ch.enabled !== false;

  const defaultChannel =
    typeof ch.default === "string" ? ch.default : DEFAULTS.channels.default;

  // Telegram — env vars override config
  const tgBotToken =
    process.env.TELEGRAM_BOT_TOKEN ||
    (typeof chTg.bot_token === "string" ? chTg.bot_token : null);

  const tgChatId =
    (process.env.TELEGRAM_CHAT_ID ? Number(process.env.TELEGRAM_CHAT_ID) : null) ||
    (typeof chTg.chat_id === "number" ? chTg.chat_id : null);

  const tgOpen = chTg.open === true;

  // Slack — env vars override config
  const slBotToken =
    process.env.SLACK_BOT_TOKEN ||
    (typeof chSl.bot_token === "string" ? chSl.bot_token : null);

  const slAppToken =
    process.env.SLACK_APP_TOKEN ||
    (typeof chSl.app_token === "string" ? chSl.app_token : null);

  const slChannelId =
    process.env.SLACK_CHANNEL_ID ||
    (typeof chSl.channel_id === "string" ? chSl.channel_id : null);

  const slDmUserId =
    typeof chSl.dm_user_id === "string" ? chSl.dm_user_id : null;

  const slBotUserId =
    typeof chSl.bot_user_id === "string" ? chSl.bot_user_id : null;
  const slBotName =
    typeof chSl.bot_name === "string" ? chSl.bot_name : null;
  const slWorkspace =
    typeof chSl.workspace === "string" ? chSl.workspace : null;
  const slWorkspaceId =
    typeof chSl.workspace_id === "string" ? chSl.workspace_id : null;
  const slWorkspaceUrl =
    typeof chSl.workspace_url === "string" ? chSl.workspace_url : null;

  return {
    model,
    timezone,
    activeHours: { start, end },
    database_url,
    log_level,
    gemini_api_key,
    channels: {
      enabled: channelsEnabled,
      default: defaultChannel,
      telegram: { bot_token: tgBotToken, chat_id: tgChatId, open: tgOpen },
      slack: { bot_token: slBotToken, app_token: slAppToken, channel_id: slChannelId, dm_user_id: slDmUserId, bot_user_id: slBotUserId, bot_name: slBotName, workspace: slWorkspace, workspace_id: slWorkspaceId, workspace_url: slWorkspaceUrl },
    },
  };
}

/** Read raw config.yaml as a plain object. Returns {} if missing or corrupt. */
export function readRawConfig(): Record<string, unknown> {
  const { config } = getPaths();
  if (!existsSync(config)) return {};
  try {
    const parsed = yaml.load(readFileSync(config, "utf8"));
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Deep merge source into target (mutates target). */
function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): void {
  for (const key of Object.keys(source)) {
    const sv = source[key];
    const tv = target[key];
    if (sv && typeof sv === "object" && !Array.isArray(sv) && tv && typeof tv === "object" && !Array.isArray(tv)) {
      deepMerge(tv as Record<string, unknown>, sv as Record<string, unknown>);
    } else {
      target[key] = sv;
    }
  }
}

/** Deep-merge fields into config.yaml and write back atomically. */
export function updateRawConfig(fields: Record<string, unknown>): void {
  const { config } = getPaths();
  const raw = readRawConfig();
  deepMerge(raw, fields);
  const dir = dirname(config);
  mkdirSync(dir, { recursive: true });
  // Back up current config before overwriting
  if (existsSync(config)) {
    copyFileSync(config, join(dir, "config.yaml.bak"));
  }
  // Write to temp file then rename for atomic update (prevents corruption on crash)
  const tmp = join(dir, `.config.yaml.tmp.${process.pid}`);
  writeFileSync(tmp, yaml.dump(raw, { lineWidth: -1 }));
  renameSync(tmp, config);
  resetConfig();
}
