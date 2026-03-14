import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname } from "path";
import yaml from "js-yaml";
import { getPaths } from "./paths";
import { log } from "./log";

export interface Config {
  model: string;
  timezone: string;
  activeHours: { start: string; end: string };
  database_url: string;
  telegram_bot_token: string | null;
  telegram_chat_id: number | null;
  telegram_open: boolean;
  slack_bot_token: string | null;
  slack_app_token: string | null;
  slack_channel_id: string | null;
  slack_dm_user_id: string | null;
  default_channel: string;
  log_level: string;
  gemini_api_key: string | null;
}

const TIME_RE = /^\d{2}:\d{2}$/;

const DEFAULTS: Config = {
  model: "default",
  timezone: process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone,
  activeHours: { start: "00:00", end: "23:59" },
  database_url: "postgres://localhost:5432/niahere",
  telegram_bot_token: null,
  telegram_chat_id: null,
  telegram_open: false,
  slack_bot_token: null,
  slack_app_token: null,
  slack_channel_id: null,
  slack_dm_user_id: null,
  default_channel: "telegram",
  log_level: "info",
  gemini_api_key: null,
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

  // Telegram — env vars override config
  const telegram_bot_token =
    process.env.TELEGRAM_BOT_TOKEN ||
    (typeof raw.telegram_bot_token === "string" ? raw.telegram_bot_token : null);

  const telegram_chat_id =
    (process.env.TELEGRAM_CHAT_ID ? Number(process.env.TELEGRAM_CHAT_ID) : null) ||
    (typeof raw.telegram_chat_id === "number" ? raw.telegram_chat_id : null);

  const telegram_open = raw.telegram_open === true;

  // Slack — env vars override config
  const slack_bot_token =
    process.env.SLACK_BOT_TOKEN ||
    (typeof raw.slack_bot_token === "string" ? raw.slack_bot_token : null);

  const slack_app_token =
    process.env.SLACK_APP_TOKEN ||
    (typeof raw.slack_app_token === "string" ? raw.slack_app_token : null);

  const slack_channel_id =
    process.env.SLACK_CHANNEL_ID ||
    (typeof raw.slack_channel_id === "string" ? raw.slack_channel_id : null);

  const slack_dm_user_id =
    typeof raw.slack_dm_user_id === "string" ? raw.slack_dm_user_id : null;

  // Default channel for outbound messages
  const default_channel =
    typeof raw.default_channel === "string" ? raw.default_channel : DEFAULTS.default_channel;

  // Log level — env var overrides config
  const log_level =
    process.env.LOG_LEVEL ||
    (typeof raw.log_level === "string" ? raw.log_level : DEFAULTS.log_level);

  // Gemini API key — env var overrides config
  const gemini_api_key =
    process.env.GEMINI_API_KEY ||
    (typeof raw.gemini_api_key === "string" ? raw.gemini_api_key : null);

  return {
    model,
    timezone,
    activeHours: { start, end },
    database_url,
    telegram_bot_token,
    telegram_chat_id,
    telegram_open,
    slack_bot_token,
    slack_app_token,
    slack_channel_id,
    slack_dm_user_id,
    default_channel,
    log_level,
    gemini_api_key,
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

/** Merge fields into config.yaml and write back. */
export function updateRawConfig(fields: Record<string, unknown>): void {
  const { config } = getPaths();
  const raw = { ...readRawConfig(), ...fields };
  mkdirSync(dirname(config), { recursive: true });
  writeFileSync(config, yaml.dump(raw, { lineWidth: -1 }));
  resetConfig();
}
