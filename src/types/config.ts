export interface TelegramConfig {
  enabled: boolean;
  bot_token: string | null;
  chat_id: number | null;
  open: boolean;
}

export interface SlackWatchChannel {
  /**
   * Optional. Three forms:
   *   - omitted/empty: use the watch name (part after # in the key) as identity,
   *     loads behavior from watches/<name>/behavior.md
   *   - single token (e.g. "kay-monitor"): override identity, loads watches/<token>/behavior.md
   *   - prose (contains whitespace): inline behavior
   */
  behavior?: string;
  enabled: boolean;
}

export interface SlackConfig {
  enabled: boolean;
  bot_token: string | null;
  app_token: string | null;
  dm_user_id: string | null;
  bot_user_id: string | null;
  bot_name: string | null;
  workspace: string | null;
  workspace_id: string | null;
  workspace_url: string | null;
  watch: Record<string, SlackWatchChannel> | null;
}

/**
 * Shared config for all Twilio-based channels (phone/sms/whatsapp).
 * Credentials, owner identity, public URL, and the local webhook port
 * live here so individual channels don't reach into each other's configs.
 */
export interface TwilioConfig {
  /** SID used for both URL paths and Basic auth.
   * Usually the Account SID (AC…). Can be an API Key SID (SK…) — Twilio resolves it. */
  sid: string | null;
  /** Basic auth password. Account Auth Token if sid is AC…, API Key Secret if SK…. */
  secret: string | null;
  /** Account-level Auth Token. Used to verify X-Twilio-Signature on inbound webhooks.
   * If sid is an API Key SID (SK…), this MUST be set separately. Falls back to `secret`
   * when sid is an Account SID and `secret` is the Auth Token. */
  auth_token: string | null;
  /** Owner's phone number (E.164). Highest-trust caller / messenger. */
  owner_number: string | null;
  /** Extra allowlisted E.164 numbers (family, close contacts). */
  allowlist: string[];
  /** Public base URL Twilio hits (e.g. https://nia.example.com). No trailing slash. */
  public_base_url: string | null;
  /** Local HTTP port the shared Twilio webhook server binds to. */
  port: number;
}

/** Voice (Twilio Programmable Voice + OpenAI Realtime). */
export interface PhoneConfig {
  enabled: boolean;
  /** Twilio number Nia dials from / inbound voice number (E.164). */
  from_number: string | null;
  /** OpenAI API key for the Realtime voice loop. */
  openai_api_key: string | null;
  /** OpenAI Realtime model id. */
  realtime_model: string;
  /** Realtime voice name (marin, alloy, echo, etc.). */
  voice: string;
}

/** SMS via Twilio (uses the shared TwilioConfig credentials). */
export interface SmsConfig {
  enabled: boolean;
  /** E.164 number SMS is sent from. Defaults to phone.from_number. */
  from_number: string | null;
}

/** WhatsApp via Twilio (sandbox by default; uses shared TwilioConfig). */
export interface WhatsappConfig {
  enabled: boolean;
  /** WhatsApp sender E.164. Defaults to Twilio Sandbox shared number +14155238886. */
  from_number: string | null;
}

export interface ChannelsConfig {
  enabled: boolean;
  default: string;
  telegram: TelegramConfig;
  slack: SlackConfig;
  twilio: TwilioConfig;
  phone: PhoneConfig;
  sms: SmsConfig;
  whatsapp: WhatsappConfig;
}

export interface SessionFinalizationConfig {
  enabled: boolean;
  memoryConsolidation: boolean;
  summaries: boolean;
}

export interface Config {
  model: string;
  runner: "claude" | "codex";
  timezone: string;
  activeHours: { start: string; end: string };
  database_url: string;
  log_level: string;
  gemini_api_key: string | null;
  sessionFinalization: SessionFinalizationConfig;
  channels: ChannelsConfig;
}
