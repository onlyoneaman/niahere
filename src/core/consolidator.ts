/**
 * Memory consolidator — stage 1 of the two-stage memory pipeline.
 *
 * After a chat session goes idle, reflects on the transcript and appends
 * CANDIDATE memories to ~/.niahere/self/staging.md. The nightly
 * memory-promoter job handles promotion from staging to memory.md/rules.md.
 * The write-path restriction is enforced by the consolidator prompt, not
 * by tool sandboxing.
 *
 * See AGENTS.md > "Two-stage memory" for the full architecture.
 */

import { Message } from "../db/models";
import { runTask } from "./runner";
import { log } from "../utils/log";
import type { SessionMessage } from "../types";

/** Bounded dedup: sessionId → message count at last consolidation. Prevents re-processing
 *  the same messages while allowing re-consolidation when new turns arrive. */
const processedCounts = new Map<string, number>();
const inFlight = new Set<string>();
const MAX_TRACKED = 500;

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

  return prefix + recent.map((m) => `[${m.sender}] (${m.createdAt}): ${m.content.slice(0, 2000)}`).join("\n\n");
}

/** Build the consolidation prompt from a conversation transcript. */
function buildConsolidationPrompt(transcript: string, source: string): string {
  const today = new Date().toISOString().slice(0, 10);
  return `Job: memory-consolidation (triggered by ${source})

A chat session has gone idle. Your task is to reflect on it and update
the memory staging log — NOT the durable memory files.

## Context

Nia uses a two-stage memory architecture. You are stage 1.

- Stage 1 (you): append candidates to \`~/.niahere/self/staging.md\`. Never
  write to \`memory.md\` or \`rules.md\` directly.
- Stage 2: the nightly \`memory-promoter\` job reviews candidates with
  \`count >= 2\` and promotes qualifying ones to durable memory. Entries with
  \`count < 2\` expire after 14 days.

Your persona includes guidance to "save proactively" — that guidance applies
to LIVE chat, where you act on immediate user instruction. In THIS
consolidation pass, your default action is to do nothing. You only act when
you can point to a specific user turn that taught you something durable.

## Transcript

${transcript}

## Step 1 — Read existing state

Read these files in full before doing anything else. You need to know what
already exists so you can dedupe and reinforce rather than duplicate.

- \`~/.niahere/self/memory.md\` — durable facts already saved
- \`~/.niahere/self/rules.md\` — behavioral rules already in effect
- \`~/.niahere/self/staging.md\` — candidates already staged (including the
  file's header, which documents the staging format)

## Step 2 — Reflect

Answer these questions silently. If the answer to all of them is "nothing",
stop here and do not write anything.

1. What did the user correct, clarify, or teach you in this session?
2. What NEW fact about the user, their projects, or their systems do you
   now know that you did not at session start?
3. What decision was made that will constrain future work?

Trivial small talk, greetings, task-execution chatter, and status updates
are NOT answers. If you cannot quote a specific user turn that produced the
learning, you are fishing — stop.

## Step 3 — Update staging.md

For each substantive answer:

1. Check \`memory.md\` and \`rules.md\`. If the learning is already covered
   there, do nothing — it is already durable.
2. Check \`staging.md\`. If there is a near-match (same subject, same intent,
   even if worded differently):
   - Use the Edit tool to bump the count: \`[1×]\` → \`[2×]\`, \`[2×]\` → \`[3×]\`
   - Update the \`last_seen\` date to \`${today}\`
   - Do NOT append a new line
3. If genuinely new AND durable AND fits one of the four types, append a
   new line to staging.md using this exact format:

   \`- [1×] [type] content :: ${today} → ${today}\`

   Where \`type\` is exactly one of:
   - \`persona\`    — facts about the user (role, habits, preferences)
   - \`project\`    — active work decisions, architecture, stakeholders
   - \`reference\`  — pointers to external systems (dashboards, repos)
   - \`correction\` — behavioral preference for how Nia should work

   If the learning does not fit one of these four types, do not stage it.

## Hard constraints

- Do NOT write to \`memory.md\` or \`rules.md\`. Only the promoter job can.
- Do NOT use \`add_memory\` or \`add_rule\` MCP tools. Edit staging.md directly.
- Do NOT message the user.
- Default action is to do nothing. Most sessions have nothing to stage.

Report a one-line summary of what you did: "staged N new / reinforced M /
skipped (trivial session)". No preamble.`;
}

async function runConsolidation(transcript: string, source: string): Promise<void> {
  const output = await runTask({
    name: "consolidator",
    prompt: buildConsolidationPrompt(transcript, source),
  });
  // runTask returns {error} on failure instead of throwing; escalate so
  // consolidateSession doesn't mark the session processed on a failed run.
  if (output.error) {
    throw new Error(`consolidator task failed: ${output.error}`);
  }
}

/**
 * Consolidate a chat session's conversation into memories.
 * Called when a chat engine goes idle or is explicitly closed.
 */
export async function consolidateSession(sessionId: string, room: string): Promise<void> {
  if (shouldSkip(room)) return;
  if (inFlight.has(sessionId)) return;

  try {
    const messages = await Message.getBySession(sessionId);
    if (messages.length < 2) return;

    // Skip if already processed this exact message count
    if (processedCounts.get(sessionId) === messages.length) return;

    inFlight.add(sessionId);

    log.info({ sessionId, room, messageCount: messages.length }, "consolidator: extracting memories from chat");

    const transcript = formatTranscript(messages);
    await runConsolidation(transcript, `chat session idle — ${room}`);

    // Mark as processed only on success
    processedCounts.set(sessionId, messages.length);

    // Evict oldest entries when over cap
    if (processedCounts.size > MAX_TRACKED) {
      const firstKey = processedCounts.keys().next().value;
      if (firstKey) processedCounts.delete(firstKey);
    }
  } catch (err) {
    log.error({ err, sessionId, room }, "consolidator: chat extraction failed");
    throw err;
  } finally {
    inFlight.delete(sessionId);
  }
}
