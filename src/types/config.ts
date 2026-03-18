export interface TelegramConfig {
  bot_token: string | null;
  chat_id: number | null;
  open: boolean;
}

export interface SlackWatchChannel {
  behavior: string;
  enabled: boolean;
}

export interface SlackConfig {
  bot_token: string | null;
  app_token: string | null;
  channel_id: string | null;
  dm_user_id: string | null;
  bot_user_id: string | null;
  bot_name: string | null;
  workspace: string | null;
  workspace_id: string | null;
  workspace_url: string | null;
  watch: Record<string, SlackWatchChannel> | null;
}

export interface ChannelsConfig {
  enabled: boolean;
  default: string;
  telegram: TelegramConfig;
  slack: SlackConfig;
}

export interface Config {
  model: string;
  runner: "claude" | "codex";
  timezone: string;
  activeHours: { start: string; end: string };
  database_url: string;
  log_level: string;
  gemini_api_key: string | null;
  channels: ChannelsConfig;
}
