import type { TurnControl } from "./coalesce";

/**
 * What counts as a reply, and what is just the model talking to itself.
 *
 * Two related jobs live here on purpose, because splitting them is how the
 * codebase ended up with two sentinel parsers that disagreed:
 *
 *  - `shouldSuppressReply` is the cross-channel guard. Control artifacts have
 *    escaped as real messages before — `nia send --help` once DM'd the flag
 *    itself — so every channel checks the same list.
 *  - `decideWatchReply` is the richer judgement a watch turn needs: it prefers
 *    a schema's answer, and can tell a bare sentinel from one tangled up with
 *    content.
 */

export const WATCH_JUDGEMENT_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    reply: {
      type: ["string", "null"],
      description: "The message to post in the channel, or null to stay silent. Most turns are null.",
    },
  },
  required: ["reply"],
  additionalProperties: false,
};

/** Strip markdown fencing so a sentinel matches even when the model wraps it.
 *  Underscores are left alone — the sentinel contains one. */
export function cleanControlReply(text: string): string {
  return text.replace(/[`*]/g, "").trim();
}

/** Outputs that are control artifacts rather than anything a person should see. */
const CONTROL_ARTIFACTS = new Set(["[NO_REPLY]", "--help", "-h"]);

/**
 * Exact matches only. "Use `--help` to see the flags" is a real answer and must
 * survive; a reply that is nothing but `--help` is the CLI leaking.
 */
export function shouldSuppressReply(text: string): boolean {
  const cleaned = cleanControlReply(text);
  return !cleaned || CONTROL_ARTIFACTS.has(cleaned);
}

export interface WatchDecision {
  /** Whether to post at all. */
  send: boolean;
  /** What to post. Empty when staying quiet. */
  text: string;
  /** Which path decided, so a drop in schema coverage is visible in the log. */
  source: "structured" | "sentinel";
  /** Set only on the sentinel path, when the model emitted both a sentinel and content. */
  ambiguous?: boolean;
}

/**
 * `structured` wins when it carries the `reply` key the schema requires —
 * including an explicit null, which is a decision, not an absence.
 *
 * The sentinel fallback matches `[NO_REPLY]` anywhere, not just exactly: a watch
 * turn that says both is confused, and staying quiet is the safer reading. That
 * is deliberately looser than `shouldSuppressReply`, which guards ordinary
 * replies where a substring match would swallow real answers.
 */
export function decideWatchReply(structured: unknown, raw: string): WatchDecision {
  if (structured && typeof structured === "object" && "reply" in structured) {
    const reply = (structured as { reply: unknown }).reply;
    const text = typeof reply === "string" ? reply.trim() : "";
    return { send: text.length > 0, text, source: "structured" };
  }

  const trimmed = raw.trim();
  const cleaned = cleanControlReply(trimmed);
  if (!trimmed || cleaned.includes("[NO_REPLY]") || CONTROL_ARTIFACTS.has(cleaned)) {
    const exact = !trimmed || CONTROL_ARTIFACTS.has(cleaned);
    return { send: false, text: "", source: "sentinel", ambiguous: !exact };
  }
  return { send: true, text: trimmed, source: "sentinel" };
}

export interface Delivery {
  /** Whether to put the text in front of the reader now. */
  post: boolean;
  /** The reply text. Kept even when held back, so the caller can log it. */
  text: string;
  /** Which path judged the reply. */
  source: WatchDecision["source"];
  /** Why it is not being posted. */
  reason?: "silent" | "ambiguous" | "superseded";
}

/**
 * The whole judgement on a finished turn's reply: is there anything to say,
 * and is it still worth saying.
 *
 * Order matters. A turn that chose silence is never asked whether it was
 * superseded — it withheld nothing, and most watch-channel turns are silent,
 * so charging them a deferral would exhaust the cap on rooms that never
 * deferred anything.
 */
export function decideDelivery(structured: unknown, raw: string, turn: Pick<TurnControl, "superseded">): Delivery {
  const decision = decideWatchReply(structured, raw);
  if (!decision.send) {
    return {
      post: false,
      text: decision.text,
      source: decision.source,
      reason: decision.ambiguous ? "ambiguous" : "silent",
    };
  }
  if (turn.superseded()) {
    return { post: false, text: decision.text, source: decision.source, reason: "superseded" };
  }
  return { post: true, text: decision.text, source: decision.source };
}
