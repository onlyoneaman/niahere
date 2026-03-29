/**
 * Memory consolidator — "hippocampal replay" for Nia.
 *
 * After a chat session goes idle or a job completes, this module reviews
 * what happened and saves memories worth keeping.
 *
 * This decouples memory formation from task execution: during a conversation,
 * the agent focuses on the task. Afterward, a background pass extracts what's
 * worth remembering — just like the brain consolidates memories during sleep.
 *
 * The consolidator uses the same agent loop as cron jobs — full Nia system
 * prompt, full tool access, same runner. It's just a specialized job.
 *
 * Research basis:
 * - LangChain: "background" memory formation avoids latency + competing optimization pressures
 * - Mem0: LLM-driven extraction with ADD/UPDATE/NOOP decisions against existing memories
 * - Cognitive science: hippocampal replay consolidates experiences after the fact, not during
 */

import { Message } from "../db/models";
import { runTask } from "./runner";
import { log } from "../utils/log";
import type { SessionMessage } from "../types";

/** Track sessions already consolidated to prevent double runs. */
const consolidated = new Set<string>();

/** Max messages to include in transcript (most recent). Keeps prompt size bounded. */
const MAX_TRANSCRIPT_MESSAGES = 50;

/** Rooms to skip (placeholder sessions). */
function shouldSkip(room: string): boolean {
  return room.includes("placeholder");
}

/** Format conversation transcript for the extraction prompt. Cap to recent messages. */
function formatTranscript(messages: SessionMessage[]): string {
  const recent = messages.slice(-MAX_TRANSCRIPT_MESSAGES);
  const skipped = messages.length - recent.length;
  const prefix = skipped > 0 ? `[...${skipped} earlier messages omitted]\n\n` : "";

  return prefix + recent
    .map((m) => `[${m.sender}] (${m.createdAt}): ${m.content.slice(0, 2000)}`)
    .join("\n\n");
}

/** Build the extraction prompt from a conversation transcript. */
function buildConsolidationPrompt(transcript: string, source: string): string {
  return `Job: memory-consolidation (triggered by ${source})

You just finished a session. It has gone idle.
Your task: review the transcript below and save anything worth keeping for future sessions.

## Transcript
${transcript}

## Instructions
1. First, read your existing memories (read_memory tool) and rules (read rules.md) to avoid duplicates
2. Review the transcript for things worth persisting. Use the RIGHT tool for each:

   **Use add_memory for FACTS** (nouns — things that are true):
   - People: names, roles, orgs, relationships
   - Decisions: what was decided or agreed on
   - Technical facts: system details, API quirks, config gotchas
   - Patterns: recurring issues, user behaviors, workflow tendencies
   - Events: travel, deadlines, incidents, milestones with dates

   **Use add_rule for INSTRUCTIONS** (verbs — how to behave):
   - User corrected your tone, format, or approach
   - User said "from now on" / "always" / "never" / "stop doing X"
   - User expressed a preference about how you communicate or work

3. Skip anything already in existing memories or rules (no duplicates)
4. Skip small talk, greetings, conversational filler
5. Skip transient state ("currently working on X")
6. Quality over quantity — saving nothing is fine if the conversation was trivial
7. If existing memories are outdated based on new info, note what should be updated

Do NOT message the user about this. Save silently and report a brief summary of what you saved.`;
}

/** Run the consolidation agent loop. */
async function runConsolidation(transcript: string, source: string): Promise<void> {
  await runTask({
    name: "consolidator",
    prompt: buildConsolidationPrompt(transcript, source),
  });
}

/**
 * Consolidate a chat session's conversation into memories.
 * Called when a chat engine goes idle or is explicitly closed.
 */
export async function consolidateSession(sessionId: string, room: string): Promise<void> {
  if (shouldSkip(room)) return;
  if (consolidated.has(sessionId)) return;
  consolidated.add(sessionId);

  try {
    const messages = await Message.getBySession(sessionId);
    if (messages.length < 2) return;

    log.info({ sessionId, room, messageCount: messages.length }, "consolidator: extracting memories from chat");

    const transcript = formatTranscript(messages);
    await runConsolidation(transcript, `chat session idle — ${room}`);
  } catch (err) {
    log.error({ err, sessionId, room }, "consolidator: chat extraction failed");
  }
}

/**
 * Consolidate a job run's output into memories.
 * Called after a job completes in the runner.
 */
export async function consolidateJobRun(jobName: string, jobPrompt: string, result: string): Promise<void> {
  // Skip if the job itself is the consolidator (prevent infinite loop)
  if (jobName === "memory-consolidation") return;

  const transcript = `[job-prompt]: ${jobPrompt}\n\n[job-result]: ${result}`;

  // Skip trivial results
  if (result.length < 50) return;

  try {
    log.info({ jobName, resultChars: result.length }, "consolidator: extracting memories from job");
    await runConsolidation(transcript, `job run — ${jobName}`);
  } catch (err) {
    log.error({ err, jobName }, "consolidator: job extraction failed");
  }
}
