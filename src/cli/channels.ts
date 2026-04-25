import { getConfig, updateRawConfig } from "../utils/config";
import { getPaths } from "../utils/paths";
import { errMsg } from "../utils/errors";
import { fail, ICON_PASS, ICON_FAIL } from "../utils/cli";
import { log } from "../utils/log";

export async function sendCommand(): Promise<void> {
  const args = process.argv.slice(3);
  let channel: string | undefined;
  let toChannelId: string | undefined;
  let threadTs: string | undefined;
  const msgParts: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if ((args[i] === "--channel" || args[i] === "-c") && args[i + 1]) {
      channel = args[++i];
    } else if (args[i] === "--to" && args[i + 1]) {
      toChannelId = args[++i];
    } else if (args[i] === "--thread" && args[i + 1]) {
      threadTs = args[++i];
    } else {
      msgParts.push(args[i]);
    }
  }
  const message = msgParts.join(" ");
  if (!message) fail("Usage: nia send [-c channel] [--to <slack-channel-id>] [--thread <ts>] <message>");

  // --to implies slack channel
  if (toChannelId) channel = channel || "slack";
  // --thread requires --to
  if (threadTs && !toChannelId) fail("--thread requires --to <slack-channel-id>");

  const { sendMessage } = await import("../mcp/tools");

  // Build sourceCtx for targeted channel/thread sends
  const sourceCtx = toChannelId
    ? { slackChannelId: toChannelId, slackThreadTs: threadTs, channel: "slack" as const }
    : undefined;
  const target = toChannelId ? "thread" as const : "auto" as const;

  try {
    const result = await sendMessage(message, channel, undefined, sourceCtx, target);
    console.log(result);
  } catch (err) {
    fail(`Failed to send: ${errMsg(err)}`);
  }
}

export function telegramCommand(): void {
  const sub = process.argv[3];

  if (sub === "setup") {
    const args = process.argv.slice(4);
    let token: string | undefined;
    let chatId: string | undefined;

    for (const arg of args) {
      if (arg.startsWith("--bot-token=")) token = arg.slice("--bot-token=".length);
      else if (arg.startsWith("--chat-id=")) chatId = arg.slice("--chat-id=".length);
    }

    if (!token) {
      fail("Usage: nia telegram setup --bot-token=<token> [--chat-id=<id>]");
    }

    const tg: Record<string, unknown> = { bot_token: token };
    if (chatId) tg.chat_id = Number(chatId);
    updateRawConfig({ channels: { telegram: tg } });

    console.log(`Telegram bot token saved to ${getPaths().config}`);
    if (chatId) console.log(`Chat ID: ${chatId}`);
    console.log("Run `nia restart` to activate.");
    return;
  }

  // Default: show status
  const config = getConfig();
  if (config.channels.telegram.bot_token) {
    console.log(`Telegram: configured (...${config.channels.telegram.bot_token.slice(-6)})`);
    if (config.channels.telegram.chat_id) {
      console.log(`  Chat ID: ${config.channels.telegram.chat_id}`);
    }
  } else {
    console.log("Telegram: not configured");
  }
  console.log("\nUsage: nia telegram setup --bot-token=<token> [--chat-id=<id>]");
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
  const sub = process.argv[3];

  if (sub === "setup") {
    const args = process.argv.slice(4);
    let botToken: string | undefined;
    let appToken: string | undefined;
    let dmUserId: string | undefined;

    for (const arg of args) {
      if (arg.startsWith("--bot-token=")) botToken = arg.slice("--bot-token=".length);
      else if (arg.startsWith("--app-token=")) appToken = arg.slice("--app-token=".length);
      else if (arg.startsWith("--dm-user-id=")) dmUserId = arg.slice("--dm-user-id=".length);
    }

    if (!botToken || !appToken) {
      fail("Usage: nia slack setup --bot-token=xoxb-... --app-token=xapp-... [--dm-user-id=U...]");
    }

    if (!botToken.startsWith("xoxb-")) {
      fail(`Invalid bot token — must start with "xoxb-" (got "${botToken.slice(0, 10)}...")`);
    }
    if (!appToken.startsWith("xapp-")) {
      fail(`Invalid app token — must start with "xapp-" (got "${appToken.slice(0, 10)}...")`);
    }

    const sl: Record<string, unknown> = { bot_token: botToken, app_token: appToken };
    if (dmUserId) sl.dm_user_id = dmUserId;

    const enriched = await enrichSlackConfig(botToken);
    Object.assign(sl, enriched);

    updateRawConfig({ channels: { slack: sl } });

    console.log(`Slack tokens saved to ${getPaths().config}`);
    if (dmUserId) console.log(`DM user: ${dmUserId}`);
    console.log("Run `nia restart` to activate.");
    return;
  }

  // Default: show status
  const config = getConfig();
  if (config.channels.slack.bot_token) {
    console.log(`Slack: configured (...${config.channels.slack.bot_token.slice(-6)})`);
    if (config.channels.slack.workspace) {
      console.log(`  Workspace: ${config.channels.slack.workspace} (${config.channels.slack.workspace_url})`);
      console.log(`  Bot: @${config.channels.slack.bot_name} (${config.channels.slack.bot_user_id})`);
    }
    if (config.channels.slack.dm_user_id) {
      console.log(`  DM user: ${config.channels.slack.dm_user_id}`);
    }
    try {
      const resp = await fetch("https://slack.com/api/auth.test", {
        headers: { Authorization: `Bearer ${config.channels.slack.bot_token}` },
      });
      const data = (await resp.json()) as Record<string, unknown>;
      if (data.ok) {
        console.log(`  Auth: ${ICON_PASS} valid`);
        if (!config.channels.slack.workspace) {
          const enriched = await enrichSlackConfig(config.channels.slack.bot_token);
          if (Object.keys(enriched).length > 0) {
            updateRawConfig({ channels: { slack: enriched } });
            console.log("  (workspace info backfilled)");
          }
        }
      } else {
        console.log(`  Auth: ${ICON_FAIL} ${data.error}`);
      }
    } catch (err) {
      console.log(`  Auth: ${ICON_FAIL} could not reach Slack API`);
    }
  } else {
    console.log("Slack: not configured");
  }
  console.log("\nUsage: nia slack setup --bot-token=xoxb-... --app-token=xapp-... [--dm-user-id=U...]");
  console.log("\nCreate a Slack app: https://api.slack.com/apps (use defaults/channels/slack-manifest.json)");
}
