import { log } from "../utils/log";
import { getConfig } from "../utils/config";
import { getSql, closeDb } from "../db/connection";

const HEARTBEAT_INTERVAL = 60_000; // 60s
const RECOVERY_THRESHOLD = 30; // 30 consecutive failures = ~30 min

let timer: ReturnType<typeof setInterval> | null = null;
let consecutiveFailures = 0;
let recoveryAttempted = false;

async function checkDb(): Promise<boolean> {
  try {
    const sql = getSql();
    await sql`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

async function attemptReconnect(): Promise<boolean> {
  try {
    await closeDb();
    // getSql() will create a fresh connection on next call
    const sql = getSql();
    await sql`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

/** Send a raw message via channel API — no DB needed, no agent needed. */
async function notifyUser(message: string): Promise<void> {
  const config = getConfig();

  // Try Telegram first
  const tgToken = config.channels.telegram.bot_token;
  const tgChatId = config.channels.telegram.chat_id;
  if (tgToken && tgChatId) {
    try {
      const { Bot } = await import("grammy");
      const bot = new Bot(tgToken);
      await bot.api.sendMessage(tgChatId, message);
      log.info("alive: notified user via telegram");
      return;
    } catch (err) {
      log.warn({ err }, "alive: telegram notification failed");
    }
  }

  // Fall back to Slack
  const slToken = config.channels.slack.bot_token;
  const slRecipient = config.channels.slack.dm_user_id || config.channels.slack.channel_id;
  if (slToken && slRecipient) {
    try {
      const resp = await fetch("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: { Authorization: `Bearer ${slToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ channel: slRecipient, text: message }),
      });
      if (resp.ok) {
        log.info("alive: notified user via slack");
        return;
      }
    } catch (err) {
      log.warn({ err }, "alive: slack notification failed");
    }
  }

  log.error("alive: could not notify user — no channel available");
}

/** Layer 1: Run an LLM recovery agent to diagnose and fix the issue. */
async function runRecoveryAgent(error: string): Promise<{ recovered: boolean; report: string }> {
  try {
    const { runJobWithClaude } = await import("./runner");
    const { homedir } = await import("os");

    const systemPrompt = [
      "You are a system recovery agent for the Nia daemon.",
      "The database connection has been failing for 30+ minutes.",
      "Your job: diagnose the issue, attempt to fix it, and report the outcome.",
      "",
      "Steps:",
      "1. Check if PostgreSQL is running: pg_isready, brew services list (macOS), systemctl status postgresql (Linux)",
      "2. If stopped, try to start it: brew services start postgresql@17 (macOS) or systemctl start postgresql (Linux)",
      "3. Wait a few seconds, then verify connectivity: psql -d niahere -c 'SELECT 1'",
      "4. If it's a different issue (disk space, permissions, etc), diagnose and report",
      "",
      "Respond with a brief postmortem:",
      "- What was wrong",
      "- What you did to fix it",
      "- Whether it's recovered or still failing",
      "- Any recommendations",
    ].join("\n");

    const jobPrompt = `Database has been unreachable for 30+ minutes.\nLast error: ${error}\n\nDiagnose and fix if possible.`;

    const result = await runJobWithClaude(systemPrompt, jobPrompt, homedir());
    const recovered = await checkDb();

    return {
      recovered,
      report: result.agentText || "Recovery agent returned no output.",
    };
  } catch (err) {
    return {
      recovered: false,
      report: `Recovery agent failed to run: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

async function heartbeat(): Promise<void> {
  const ok = await checkDb();

  if (ok) {
    if (consecutiveFailures > 0) {
      log.info({ previousFailures: consecutiveFailures }, "alive: database recovered");
      if (consecutiveFailures >= RECOVERY_THRESHOLD) {
        await notifyUser(`Database recovered after ${consecutiveFailures} minutes of downtime.`);
      }
    }
    consecutiveFailures = 0;
    recoveryAttempted = false;
    return;
  }

  consecutiveFailures++;
  log.warn({ consecutiveFailures }, "alive: database unreachable");

  // Try reconnect on every failure
  const reconnected = await attemptReconnect();
  if (reconnected) {
    log.info("alive: reconnected to database");
    consecutiveFailures = 0;
    recoveryAttempted = false;
    return;
  }

  // After threshold, trigger recovery (once)
  if (consecutiveFailures >= RECOVERY_THRESHOLD && !recoveryAttempted) {
    recoveryAttempted = true;
    log.info("alive: triggering recovery after " + consecutiveFailures + " failures");

    // Layer 1: LLM recovery agent
    const lastError = "PostgreSQL unreachable after " + consecutiveFailures + " consecutive heartbeat failures";
    const { recovered, report } = await runRecoveryAgent(lastError);

    if (recovered) {
      log.info("alive: recovery agent succeeded");
      await notifyUser(`Database was down for ~${consecutiveFailures} min. Recovery agent fixed it.\n\n${report}`);
      consecutiveFailures = 0;
      recoveryAttempted = false;
    } else {
      // Layer 2: Direct notification
      log.error("alive: recovery agent failed, notifying user");
      await notifyUser(
        `Database has been down for ~${consecutiveFailures} min and auto-recovery failed.\n\n` +
        `Recovery report:\n${report}\n\n` +
        `Run \`nia health\` to check status. You may need to restart PostgreSQL manually.`
      );
    }
  }
}

export function startAlive(): void {
  log.info("alive started (60s heartbeat)");
  // Initial check after a short delay (let startup finish)
  setTimeout(heartbeat, 10_000);
  timer = setInterval(heartbeat, HEARTBEAT_INTERVAL);
}

export function stopAlive(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
