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

import { Message, Session } from "../db/models";
import { runTask } from "./runner";
import { log } from "../utils/log";
import type { SessionMessage } from "../types";

const inFlight = new Set<string>();

/** Max messages in one transcript. Keeps the prompt bounded. */
const MAX_TRANSCRIPT_MESSAGES = 50;

/** New turns required before a session already consolidated is looked at again.
 *  Without it, a long-running room re-sends its whole window on every message. */
export const MIN_NEW_MESSAGES = 6;

/** Prior turns replayed alongside new ones, so a learning that spans the
 *  boundary is not cut in half. */
export const CONTEXT_TAIL = 5;

export interface ConsolidationPlan {
  run: boolean;
  /** Index into the session's messages to start the transcript from. */
  from: number;
}

/**
 * Decide whether a session is worth (re-)reading and over what window.
 *
 * A session is always read once — a correction can be two turns, and skipping
 * short sessions starves the pipeline. After that it takes a real batch of new
 * turns to justify another pass, and only the new tail is re-read.
 */
export function planConsolidation(total: number, consolidated: number): ConsolidationPlan {
  const floor = Math.max(0, total - MAX_TRANSCRIPT_MESSAGES);

  if (consolidated <= 0) {
    return { run: total >= 2, from: floor };
  }
  if (total - consolidated < MIN_NEW_MESSAGES) {
    return { run: false, from: floor };
  }
  return { run: true, from: Math.max(floor, consolidated - CONTEXT_TAIL) };
}

/** Rooms to skip (placeholder sessions). */
function shouldSkip(room: string): boolean {
  return room.includes("placeholder");
}

/** Format the transcript window for the extraction prompt. */
function formatTranscript(messages: SessionMessage[], from: number, consolidated: number): string {
  const window = messages.slice(from);
  const prefix = from > 0 ? `[...${from} earlier messages already consolidated, omitted]\n\n` : "";
  const seen = Math.max(0, consolidated - from);
  const marker = seen > 0 ? `\n\n--- everything below is NEW since the last pass ---\n` : "";

  const lines = window.map(
    (m, i) => `${i === seen && marker ? marker : ""}[${m.sender}] (${m.createdAt}): ${m.content.slice(0, 2000)}`,
  );
  return prefix + lines.join("\n\n");
}

/** Build the consolidation prompt from a conversation transcript. */
export function buildConsolidationPrompt(transcript: string, source: string): string {
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
consolidation pass, be selective but not paralyzed. If you see a genuine
learning, stage it. The promoter handles quality gating — your job is to
not miss real signals, not to be maximally conservative.

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
   (Includes: "no, do it this way", "don't use X", "always check Y first")
2. What NEW fact about the user, their projects, or their systems do you
   now know that you did not at session start?
   (Includes: architecture decisions, workflow patterns, tool preferences,
   team structure, external system details discovered during task execution)
3. What decision was made that will constrain future work?
   (Includes: "we're using X not Y", config changes, deployment patterns)
4. What did the user explicitly ask to be remembered?

Corrections made DURING task execution ("no, check DynamoDB not S3"),
architecture learned while debugging ("ah, this service talks to X via Y"),
and workflow patterns revealed by how the user works — these ARE answers.

**The bar is durability: would this still be true and useful in 30 days?**
"Would a fresh session benefit" is too weak — it admits anything mildly
relevant. A fact that expires with the week is noise once it expires.

Never stage any of these, however interesting they seemed in the moment:

- **Transient state** — what a service was doing today, a current error, a
  job's latest output, "X is down". True this hour, misleading next month.
- **One-off events** — a single incident, a one-time request, "we deployed
  at 3pm". A pattern needs repetition; one occurrence is an anecdote.
- **Derivable facts** — anything already in the repo, config, git history,
  or \`nia status\`. If a future session can look it up, it does not need
  remembering.
- **Task chatter** — what was done this session, progress reports, what to
  do next. That belongs in the work, not in who the user is.
- **Restatements** — a rewording of something in \`memory.md\` or \`rules.md\`.
  Reinforce the existing entry instead (Step 3.2).

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
- If nothing qualifies, do nothing. But don't be so conservative that the
  pipeline starves — if you're skipping every session, your bar is too high.
  Most sessions should yield zero or one candidate. Several is suspicious;
  re-check them against the exclusion list before writing.

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
    const consolidated = await Session.getConsolidatedCount(sessionId);
    const plan = planConsolidation(messages.length, consolidated);
    if (!plan.run) return;

    inFlight.add(sessionId);

    log.info(
      { sessionId, room, messageCount: messages.length, consolidated, from: plan.from },
      "consolidator: extracting memories from chat",
    );

    const transcript = formatTranscript(messages, plan.from, consolidated);
    await runConsolidation(transcript, `chat session idle — ${room}`);

    // Advance the watermark only on success.
    await Session.setConsolidatedCount(sessionId, messages.length);
  } catch (err) {
    log.error({ err, sessionId, room }, "consolidator: chat extraction failed");
    throw err;
  } finally {
    inFlight.delete(sessionId);
  }
}
