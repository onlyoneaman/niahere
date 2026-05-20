export interface TelegramConfig {
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

export interface PhoneConfig {
  twilio_sid: string | null;
  twilio_secret: string | null;
  /** Account-level Auth Token used to verify X-Twilio-Signature on inbound webhooks.
   *  Falls back to twilio_secret if not set (works when twilio_sid is the Account SID
   *  and twilio_secret is the Auth Token). */
  twilio_auth_token: string | null;
  /** Twilio number Nia dials from (E.164, e.g. +13025480697) */
  from_number: string | null;
  /** Owner's phone number (E.164). Highest-trust caller. */
  owner_number: string | null;
  /** Extra allowlisted E.164 numbers (family, close contacts). */
  allowlist: string[];
  /** Public base URL Twilio hits (e.g. https://nia.example.com). No trailing slash. */
  public_base_url: string | null;
  /** Local HTTP port for the Twilio webhook server. */
  port: number;
  /** OpenAI API key for the Realtime voice loop. */
  openai_api_key: string | null;
  /** OpenAI Realtime model id. */
  realtime_model: string;
  /** Realtime voice name (marin, alloy, echo, etc.). */
  voice: string;
}

export interface ChannelsConfig {
  enabled: boolean;
  default: string;
  telegram: TelegramConfig;
  slack: SlackConfig;
  phone: PhoneConfig;
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
