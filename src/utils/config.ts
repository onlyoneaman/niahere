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
  runner: "claude",
  timezone: process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone,
  activeHours: { start: "00:00", end: "23:59" },
  database_url: DEFAULT_DATABASE_URL,
  log_level: "info",
  gemini_api_key: null,
  sessionFinalization: {
    enabled: true,
    memoryConsolidation: true,
    summaries: true,
  },
  channels: {
    enabled: true,
    default: "telegram",
    telegram: { bot_token: null, chat_id: null, open: false },
    slack: {
      bot_token: null,
      app_token: null,
      dm_user_id: null,
      bot_user_id: null,
      bot_name: null,
      workspace: null,
      workspace_id: null,
      workspace_url: null,
      watch: null,
    },
    twilio: {
      sid: null,
      secret: null,
      auth_token: null,
      owner_number: null,
      allowlist: [],
      public_base_url: null,
      port: 7079,
    },
    phone: {
      enabled: true,
      from_number: null,
      openai_api_key: null,
      realtime_model: "gpt-realtime",
      voice: "marin",
    },
    sms: {
      enabled: true,
      from_number: null,
    },
    whatsapp: {
      enabled: true,
      from_number: "+14155238886",
    },
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

  // Runner — "codex" is opt-in, everything else defaults to "claude"
  const runner: Config["runner"] = raw.runner === "codex" ? "codex" : DEFAULTS.runner;

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
    process.env.DATABASE_URL || (typeof raw.database_url === "string" ? raw.database_url : DEFAULTS.database_url);

  // Log level — env var overrides config
  const log_level = process.env.LOG_LEVEL || (typeof raw.log_level === "string" ? raw.log_level : DEFAULTS.log_level);

  // Gemini API key — env var overrides config
  const gemini_api_key =
    process.env.GEMINI_API_KEY || (typeof raw.gemini_api_key === "string" ? raw.gemini_api_key : null);

  // Session finalization — controls post-session background LLM work.
  const sf = (raw.session_finalization || {}) as Record<string, unknown>;
  const sessionFinalization = {
    enabled: sf.enabled !== false,
    memoryConsolidation: sf.memory_consolidation !== false,
    summaries: sf.summaries !== false,
  };

  // --- Channels (nested under `channels:` in yaml) ---
  const ch = (raw.channels || {}) as Record<string, unknown>;
  const chTg = (ch.telegram || {}) as Record<string, unknown>;
  const chSl = (ch.slack || {}) as Record<string, unknown>;
  const chPh = (ch.phone || {}) as Record<string, unknown>;
  const chTw = (ch.twilio || {}) as Record<string, unknown>;
  const chSms = (ch.sms || {}) as Record<string, unknown>;
  const chWa = (ch.whatsapp || {}) as Record<string, unknown>;

  const twilioField = (key: string, envKey: string | null): string | null => {
    const envVal = envKey ? process.env[envKey] : undefined;
    if (envVal) return envVal;
    return typeof chTw[key] === "string" ? (chTw[key] as string) : null;
  };

  const channelsEnabled = ch.enabled !== false;

  const defaultChannel = typeof ch.default === "string" ? ch.default : DEFAULTS.channels.default;

  // Telegram — env vars override config
  const tgBotToken = process.env.TELEGRAM_BOT_TOKEN || (typeof chTg.bot_token === "string" ? chTg.bot_token : null);

  const tgChatId =
    (process.env.TELEGRAM_CHAT_ID ? Number(process.env.TELEGRAM_CHAT_ID) : null) ||
    (typeof chTg.chat_id === "number" ? chTg.chat_id : null);

  const tgOpen = chTg.open === true;

  // Slack — env vars override config
  const slBotToken = process.env.SLACK_BOT_TOKEN || (typeof chSl.bot_token === "string" ? chSl.bot_token : null);

  const slAppToken = process.env.SLACK_APP_TOKEN || (typeof chSl.app_token === "string" ? chSl.app_token : null);

  // Legacy: channel_id was removed in favor of dm_user_id. Fall back to channel_id if dm_user_id is not set.
  const legacyChannelId =
    process.env.SLACK_CHANNEL_ID || (typeof chSl.channel_id === "string" ? chSl.channel_id : null);
  const slDmUserId =
    process.env.SLACK_DM_USER_ID || (typeof chSl.dm_user_id === "string" ? chSl.dm_user_id : null) || legacyChannelId;

  const slBotUserId = typeof chSl.bot_user_id === "string" ? chSl.bot_user_id : null;
  const slBotName = typeof chSl.bot_name === "string" ? chSl.bot_name : null;
  const slWorkspace = typeof chSl.workspace === "string" ? chSl.workspace : null;
  const slWorkspaceId = typeof chSl.workspace_id === "string" ? chSl.workspace_id : null;
  const slWorkspaceUrl = typeof chSl.workspace_url === "string" ? chSl.workspace_url : null;

  // --- Twilio shared config (used by phone, sms, whatsapp) ---
  // Env vars take precedence over channels.twilio.* values.
  const twSid = twilioField("sid", "TWILIO_SID");
  const twSecret = twilioField("secret", "TWILIO_SECRET");
  const twAuthToken = twilioField("auth_token", "TWILIO_AUTH_TOKEN");
  const twOwnerNumber = twilioField("owner_number", "PRIMARY_PHONE_USER");
  const twPublicBaseUrl = (twilioField("public_base_url", "PUBLIC_BASE_URL") || "").replace(/\/$/, "") || null;

  const twPortRaw = process.env.PHONE_PORT ? Number(process.env.PHONE_PORT) : null;
  const twPort =
    twPortRaw && Number.isFinite(twPortRaw)
      ? twPortRaw
      : typeof chTw.port === "number"
        ? chTw.port
        : DEFAULTS.channels.twilio.port;

  const twAllowlistRaw =
    process.env.PHONE_ALLOWLIST ||
    (Array.isArray(chTw.allowlist)
      ? (chTw.allowlist as unknown[]).filter((x): x is string => typeof x === "string").join(",")
      : "");
  const twAllowlist = twAllowlistRaw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  // --- Phone (voice) — env vars and new keys override legacy ---
  const phFromNumber =
    process.env.PHONE_FROM_NUMBER || (typeof chPh.from_number === "string" ? chPh.from_number : null);
  const phOpenAiKey =
    process.env.OPENAI_API_KEY || (typeof chPh.openai_api_key === "string" ? chPh.openai_api_key : null);
  const phRealtimeModel =
    process.env.PHONE_REALTIME_MODEL ||
    (typeof chPh.realtime_model === "string" ? chPh.realtime_model : DEFAULTS.channels.phone.realtime_model);
  const phVoice =
    process.env.PHONE_VOICE || (typeof chPh.voice === "string" ? chPh.voice : DEFAULTS.channels.phone.voice);
  const phEnabled = chPh.enabled !== false;

  // --- SMS ---
  const smsFromNumber =
    process.env.SMS_FROM_NUMBER || (typeof chSms.from_number === "string" ? chSms.from_number : null);
  const smsEnabled = chSms.enabled !== false;

  // --- WhatsApp ---
  const waFromNumber =
    process.env.WHATSAPP_FROM_NUMBER ||
    (typeof chWa.from_number === "string" ? chWa.from_number : DEFAULTS.channels.whatsapp.from_number);
  const waEnabled = chWa.enabled !== false;

  // Slack watch channels — behavior is optional (defaults to key name lookup)
  const rawWatch = chSl.watch as Record<string, unknown> | undefined;
  let slWatch: Record<string, { behavior?: string; enabled: boolean }> | null = null;
  if (rawWatch && typeof rawWatch === "object") {
    slWatch = {};
    for (const [name, val] of Object.entries(rawWatch)) {
      if (val && typeof val === "object") {
        const enabled = (val as any).enabled !== false; // default true
        const behavior = typeof (val as any).behavior === "string" ? (val as any).behavior : undefined;
        slWatch[name] = { behavior, enabled };
      }
    }
    if (Object.keys(slWatch).length === 0) slWatch = null;
  }

  return {
    model,
    runner,
    timezone,
    activeHours: { start, end },
    database_url,
    log_level,
    gemini_api_key,
    sessionFinalization,
    channels: {
      enabled: channelsEnabled,
      default: defaultChannel,
      telegram: { bot_token: tgBotToken, chat_id: tgChatId, open: tgOpen },
      slack: {
        bot_token: slBotToken,
        app_token: slAppToken,
        dm_user_id: slDmUserId,
        bot_user_id: slBotUserId,
        bot_name: slBotName,
        workspace: slWorkspace,
        workspace_id: slWorkspaceId,
        workspace_url: slWorkspaceUrl,
        watch: slWatch,
      },
      twilio: {
        sid: twSid,
        secret: twSecret,
        auth_token: twAuthToken,
        owner_number: twOwnerNumber,
        allowlist: twAllowlist,
        public_base_url: twPublicBaseUrl,
        port: twPort,
      },
      phone: {
        enabled: phEnabled,
        from_number: phFromNumber,
        openai_api_key: phOpenAiKey,
        realtime_model: phRealtimeModel,
        voice: phVoice,
      },
      sms: {
        enabled: smsEnabled,
        from_number: smsFromNumber,
      },
      whatsapp: {
        enabled: waEnabled,
        from_number: waFromNumber,
      },
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
  const raw = readRawConfig();
  deepMerge(raw, fields);
  writeRawConfig(raw);
}

/** Write a full config object to config.yaml atomically (backup + temp + rename). */
export function writeRawConfig(raw: Record<string, unknown>): void {
  const { config } = getPaths();
  const dir = dirname(config);
  mkdirSync(dir, { recursive: true });
  if (existsSync(config)) {
    copyFileSync(config, join(dir, "config.yaml.bak"));
  }
  const tmp = join(dir, `.config.yaml.tmp.${process.pid}`);
  writeFileSync(tmp, yaml.dump(raw, { lineWidth: -1 }));
  renameSync(tmp, config);
  resetConfig();
}
