/**
 * Session summarizer — generates a brief handoff note when a session ends.
 *
 * Separate from memory consolidation. The consolidator extracts durable facts
 * (memories/rules). The summarizer produces a short, ephemeral context bridge
 * so the next session knows what just happened.
 *
 * Summaries are stored directly in the sessions table (summary column) via SQL.
 * The last few summaries are injected into buildSystemPrompt() so new sessions
 * have continuity without needing full transcript access.
 */

import { Message, Session } from "../db/models";
import { buildSystemPrompt } from "../chat/identity";
import { runJobWithClaude } from "./runner";
import { log } from "../utils/log";
import { homedir } from "os";
import type { SessionMessage } from "../types";

/** Track sessions already summarized to prevent double runs. */
const summarized = new Set<string>();

/** Max messages to include (most recent). */
const MAX_MESSAGES = 30;

/** Format transcript for the summarization prompt. */
function formatTranscript(messages: SessionMessage[]): string {
  const recent = messages.slice(-MAX_MESSAGES);
  return recent
    .map((m) => `[${m.sender}]: ${m.content.slice(0, 1000)}`)
    .join("\n");
}

/**
 * Summarize a session and store the result in the sessions table.
 * Called when a chat engine goes idle — produces a context bridge for the next session.
 */
export async function summarizeSession(sessionId: string, room: string): Promise<void> {
  if (room.includes("placeholder")) return;
  if (summarized.has(sessionId)) return;
  summarized.add(sessionId);

  try {
    const messages = await Message.getBySession(sessionId);
    if (messages.length < 2) return;

    log.info({ sessionId, room, messageCount: messages.length }, "summarizer: generating session summary");

    const systemPrompt = buildSystemPrompt("job");
    const transcript = formatTranscript(messages);

    const jobPrompt = `Job: session-summary (triggered by session idle in ${room})

Generate a brief session summary. This will be shown to your future self at the start of the next session for continuity.

## Conversation
${transcript}

## Instructions
Write a 2-4 sentence summary covering:
- What was discussed or worked on
- Any decisions made or outcomes reached
- Anything pending or unresolved

Keep it concise — a handoff note, not a report. Output ONLY the summary text.`;

    const output = await runJobWithClaude(systemPrompt, jobPrompt, homedir());

    if (output.error) {
      log.error({ sessionId, room, error: output.error }, "summarizer: failed");
      return;
    }

    const summary = output.agentText.trim();
    if (summary && summary.length > 10 && summary.length < 2000) {
      await Session.setSummary(sessionId, summary);
      log.info({ sessionId, room, summaryChars: summary.length }, "summarizer: saved");
    } else {
      log.warn({ sessionId, room, length: summary.length }, "summarizer: output too short or too long, skipped");
    }
  } catch (err) {
    log.error({ err, sessionId, room }, "summarizer: failed");
  }
}
