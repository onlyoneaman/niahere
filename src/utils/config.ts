import { existsSync, readFileSync } from "fs";
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
  log_level: string;
}

const TIME_RE = /^\d{2}:\d{2}$/;

const DEFAULTS: Config = {
  model: "default",
  timezone: process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone,
  activeHours: { start: "00:00", end: "23:59" },
  database_url: "postgres://localhost:5432/niahere",
  telegram_bot_token: null,
  telegram_chat_id: null,
  log_level: "info",
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

  // Log level — env var overrides config
  const log_level =
    process.env.LOG_LEVEL ||
    (typeof raw.log_level === "string" ? raw.log_level : DEFAULTS.log_level);

  return {
    model,
    timezone,
    activeHours: { start, end },
    database_url,
    telegram_bot_token,
    telegram_chat_id,
    log_level,
  };
}
