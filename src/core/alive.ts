import { log } from "../utils/log";
import { getConfig } from "../utils/config";
import { getSql, closeDb } from "../db/connection";
import { getFailures, type Check } from "./health";

const HEARTBEAT_INTERVAL = 60_000; // 60s

let timer: ReturnType<typeof setInterval> | null = null;
let lastFailures: string[] = [];
let recoveryAttempted = false;

async function attemptDbReconnect(): Promise<boolean> {
  try {
    await closeDb();
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

/** Run LLM recovery agent for failures it can fix (e.g. DB down). */
async function runRecoveryAgent(failures: Check[]): Promise<{ recovered: boolean; report: string }> {
  try {
    const { runJobWithClaude } = await import("./runner");
    const { homedir } = await import("os");

    const failureSummary = failures.map((f) => `- ${f.name}: ${f.detail}`).join("\n");

    const systemPrompt = [
      "You are a system recovery agent for the Nia daemon.",
      "Health checks detected failures. Diagnose and fix what you can.",
      "",
      "For database issues:",
      "1. Check: pg_isready, brew services list (macOS), systemctl status postgresql (Linux)",
      "2. Fix: brew services start postgresql@17 (macOS) or systemctl start postgresql (Linux)",
      "3. Verify: psql -d niahere -c 'SELECT 1'",
      "",
      "For other issues: diagnose, attempt fix if safe, report findings.",
      "",
      "Respond with a brief postmortem:",
      "- What was wrong",
      "- What you did",
      "- Current status",
    ].join("\n");

    const jobPrompt = `Health check failures:\n${failureSummary}\n\nDiagnose and fix.`;

    const result = await runJobWithClaude(systemPrompt, jobPrompt, homedir());

    // Re-check after recovery attempt
    const remaining = await getFailures();
    return {
      recovered: remaining.length === 0,
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
  const failures = await getFailures();
  const failureNames = failures.map((f) => f.name);

  // All clear
  if (failures.length === 0) {
    if (lastFailures.length > 0) {
      log.info({ recovered: lastFailures }, "alive: all checks passing");
      await notifyUser(`Recovered: ${lastFailures.join(", ")} back to normal.`);
    }
    lastFailures = [];
    recoveryAttempted = false;
    return;
  }

  // New failures detected
  const newFailures = failureNames.filter((f) => !lastFailures.includes(f));
  if (newFailures.length > 0) {
    log.warn({ failures: failureNames }, "alive: health check failures detected");
  }

  // Try DB reconnect if database is failing
  if (failureNames.includes("database")) {
    const reconnected = await attemptDbReconnect();
    if (reconnected) {
      log.info("alive: database reconnected");
      // Re-check everything
      const remaining = await getFailures();
      if (remaining.length === 0) {
        lastFailures = [];
        recoveryAttempted = false;
        return;
      }
    }
  }

  // Run recovery agent once per outage
  if (!recoveryAttempted) {
    recoveryAttempted = true;
    log.info({ failures: failureNames }, "alive: running recovery agent");

    const { recovered, report } = await runRecoveryAgent(failures);

    if (recovered) {
      log.info({ report }, "alive: recovery agent succeeded");
      await notifyUser(report);
      lastFailures = [];
      recoveryAttempted = false;
    } else {
      log.error({ report }, "alive: recovery failed, notifying user");
      await notifyUser(report);
    }
  }

  lastFailures = failureNames;
}

export function startAlive(): void {
  log.info("alive started (60s heartbeat)");
  setTimeout(heartbeat, 10_000);
  timer = setInterval(heartbeat, HEARTBEAT_INTERVAL);
}

export function stopAlive(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
