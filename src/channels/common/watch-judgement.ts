/**
 * A watch turn answers one question: say something, or stay quiet.
 *
 * That answer used to travel as a `[NO_REPLY]` sentinel inside prose, which
 * means parsing a decision out of an answer that was free to phrase it any way
 * it liked. It mostly worked — and 47 times it produced the sentinel *and*
 * content, where the code has to guess which the model meant.
 *
 * A schema removes the guess. The sentinel path stays as the fallback, because
 * a backend can decline to produce structured output and a watch that stops
 * deciding is worse than one that decides the old way.
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

/** Strip markdown fencing so a sentinel matches even when the model wraps it.
 *  Underscores are left alone — the sentinel contains one. */
export function cleanSentinel(text: string): string {
  return text.replace(/[`*]/g, "").trim();
}

/**
 * `structured` wins when it carries the `reply` key the schema requires —
 * including an explicit null, which is a decision, not an absence.
 */
export function decideWatchReply(structured: unknown, raw: string): WatchDecision {
  if (structured && typeof structured === "object" && "reply" in structured) {
    const reply = (structured as { reply: unknown }).reply;
    const text = typeof reply === "string" ? reply.trim() : "";
    return { send: text.length > 0, text, source: "structured" };
  }

  const trimmed = raw.trim();
  const cleaned = cleanSentinel(trimmed);
  if (!trimmed || cleaned.includes("[NO_REPLY]")) {
    const exact = !trimmed || cleaned === "[NO_REPLY]";
    return { send: false, text: "", source: "sentinel", ambiguous: !exact };
  }
  return { send: true, text: trimmed, source: "sentinel" };
}
