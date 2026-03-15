import { getConfig, updateRawConfig } from "../utils/config";
import { withDb } from "../db/connection";
import { getPaths } from "../utils/paths";
import { errMsg } from "../utils/errors";
import { fail } from "../utils/cli";

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
    await withDb(async () => {
      const result = await sendMessage(message, channel);
      console.log(result);
    });
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

export function slackCommand(): void {
  const botToken = process.argv[3];
  const appToken = process.argv[4];

  if (!botToken) {
    const config = getConfig();
    if (config.channels.slack.bot_token) {
      console.log(`Slack: configured (...${config.channels.slack.bot_token.slice(-6)})`);
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
  updateRawConfig({ channels: { slack: sl } });

  console.log(`Slack tokens saved to ${getPaths().config}`);
  if (channelId) console.log(`Channel ID: ${channelId}`);
  console.log("Run `nia restart` to activate.");
}
