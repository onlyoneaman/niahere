import { getConfig, updateRawConfig } from "../utils/config";
import { getPaths } from "../utils/paths";
import { errMsg } from "../utils/errors";
import { fail } from "../utils/cli";
import { log } from "../utils/log";

export async function sendCommand(): Promise<void> {
  const args = process.argv.slice(3);
  let channel: string | undefined;
  const msgParts: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if ((args[i] === "--channel" || args[i] === "-c") && args[i + 1]) {
      channel = args[++i];
    } else {
      msgParts.push(args[i]);
    }
  }
  const message = msgParts.join(" ");
  if (!message) fail("Usage: nia send [-c channel] <message>");

  const { sendMessage } = await import("../mcp/tools");

  try {
    const result = await sendMessage(message, channel);
    console.log(result);
  } catch (err) {
    fail(`Failed to send: ${errMsg(err)}`);
  }
}

export function telegramCommand(): void {
  const token = process.argv[3];
  const chatId = process.argv[4];

  if (!token) {
    const config = getConfig();
    if (config.channels.telegram.bot_token) {
      console.log(`Telegram: configured (...${config.channels.telegram.bot_token.slice(-6)})`);
    } else {
      console.log("Telegram: not configured");
    }
    console.log("\nUsage: nia telegram <bot-token> [chat-id]");
    return;
  }

  const tg: Record<string, unknown> = { bot_token: token };
  if (chatId) tg.chat_id = Number(chatId);
  updateRawConfig({ channels: { telegram: tg } });

  console.log(`Telegram bot token saved to ${getPaths().config}`);
  if (chatId) console.log(`Chat ID: ${chatId}`);
  console.log("Run `nia restart` to activate.");
}

/** Call Slack auth.test to enrich config with workspace/bot info. */
export async function enrichSlackConfig(botToken: string): Promise<Record<string, unknown>> {
  try {
    const resp = await fetch("https://slack.com/api/auth.test", {
      headers: { Authorization: `Bearer ${botToken}` },
    });
    const data = (await resp.json()) as Record<string, unknown>;
    if (!data.ok) {
      log.warn({ error: data.error }, "Slack auth.test failed, skipping enrichment");
      return {};
    }
    const enriched = {
      bot_user_id: data.user_id,
      bot_name: data.user,
      workspace: data.team,
      workspace_id: data.team_id,
      workspace_url: data.url,
    };
    console.log(`  Slack workspace: ${data.team} (${data.url})`);
    console.log(`  Bot: @${data.user} (${data.user_id})`);
    return enriched;
  } catch (err) {
    log.warn({ err }, "Failed to reach Slack API, skipping enrichment");
    return {};
  }
}

export async function slackCommand(): Promise<void> {
  const botToken = process.argv[3];
  const appToken = process.argv[4];

  if (!botToken) {
    const config = getConfig();
    if (config.channels.slack.bot_token) {
      console.log(`Slack: configured (...${config.channels.slack.bot_token.slice(-6)})`);
      if (config.channels.slack.workspace) {
        console.log(`  Workspace: ${config.channels.slack.workspace} (${config.channels.slack.workspace_url})`);
        console.log(`  Bot: @${config.channels.slack.bot_name} (${config.channels.slack.bot_user_id})`);
      }
    } else {
      console.log("Slack: not configured");
    }
    console.log("\nUsage: nia slack <bot-token> <app-token> [channel-id]");
    console.log("\nCreate a Slack app: https://api.slack.com/apps (use defaults/channels/slack-manifest.json)");
    return;
  }

  if (!appToken) fail("App token required. Usage: nia slack <bot-token> <app-token> [channel-id]");

  const sl: Record<string, unknown> = { bot_token: botToken, app_token: appToken };
  const channelId = process.argv[5];
  if (channelId) sl.channel_id = channelId;

  // Enrich with workspace/bot info from auth.test
  const enriched = await enrichSlackConfig(botToken);
  Object.assign(sl, enriched);

  updateRawConfig({ channels: { slack: sl } });

  console.log(`Slack tokens saved to ${getPaths().config}`);
  if (channelId) console.log(`Channel ID: ${channelId}`);
  console.log("Run `nia restart` to activate.");
}
