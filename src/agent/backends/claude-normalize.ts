import type { AgentEvent, Normalizer } from "../types";
import { truncate } from "../../utils/format-activity";
import { isRetryable, scopeOf, parseFailure } from "../failure";
import type { FailoverScope } from "../types";

/**
 * Terminal reasons that mean the turn died. The SDK used to report several of
 * these as `completed`, so a dead turn landed in the audit as a successful run.
 * The value is how far the chain should skip; undefined means stop.
 */
const DEAD_TURNS: Record<string, FailoverScope | undefined> = {
  api_error: "provider",
  // This account is out of capacity, not this model — another provider can
  // still answer. Left unmapped, an exhausted plan reads as a completed turn.
  blocking_limit: "provider",
  rapid_refill_breaker: "provider",
  // The model is the problem; the next one in the chain may not be.
  model_error: "model",
  prompt_too_long: "model",
  budget_exhausted: undefined,
  // No provider will parse the image differently, so there is nothing to fail
  // over to — stop and say so.
  image_error: undefined,
  malformed_tool_use_exhausted: undefined,
  structured_output_retry_exhausted: undefined,
  tool_deferred_unavailable: undefined,
  turn_setup_failed: undefined,
};

/**
 * Say as much about a failed turn as the result message allows.
 *
 * `errors` is routinely empty on an errored result. Collapsing that to the
 * string "unknown error" cost sixteen days of Nia answering as Codex with 649
 * failures that named no cause and so raised no question. Anything the message
 * still carries beats a word that means nothing.
 */
export function describeFailure(msg: {
  errors?: unknown;
  subtype?: unknown;
  stop_reason?: unknown;
  terminal_reason?: unknown;
  api_error_status?: unknown;
  result?: unknown;
}): string {
  const errors = Array.isArray(msg.errors) ? msg.errors.filter((e) => typeof e === "string" && e.trim()) : [];
  if (errors.length > 0) return errors.join(", ");

  const parts: string[] = [];
  const add = (label: string, value: unknown) => {
    if (typeof value === "string" && value.trim()) parts.push(`${label}=${value.trim()}`);
    else if (typeof value === "number") parts.push(`${label}=${value}`);
  };
  add("http", msg.api_error_status);
  add("subtype", msg.subtype);
  add("stop_reason", msg.stop_reason);
  add("terminal_reason", msg.terminal_reason);
  if (typeof msg.result === "string" && msg.result.trim()) parts.push(`result=${truncate(msg.result.trim(), 200)}`);

  return parts.length > 0
    ? `claude reported an error with no message (${parts.join(" ")})`
    : "claude reported an error with no message and no detail";
}

/**
 * Stamp the chain's provider over the SDK's own, which names the deployment
 * target (firstParty/bedrock/vertex) — a different axis from which backend ran
 * the turn, and the one `providers_used` has to answer.
 */
function attribute(modelUsage: unknown): Record<string, unknown> | undefined {
  if (!modelUsage || typeof modelUsage !== "object") return undefined;
  return Object.fromEntries(
    Object.entries(modelUsage as Record<string, unknown>).map(([model, usage]) => [
      model,
      { ...(usage as object), provider: "claude" },
    ]),
  );
}

/**
 * Pure reducer: Claude Agent SDK messages → normalized `AgentEvent`s.
 *
 * Ports the consume-loop handling that lived inline in `engine.ts` and
 * `runner.ts`, so the two paths share one implementation. Holds only the
 * thinking-accumulation state those loops kept as locals. No I/O, no timers —
 * the session that drives it owns all orchestration.
 *
 * Display strings (truncation, `formatToolUse`, the `$ ` Bash prefix) are
 * produced here so behavior is byte-identical to the old loops and consumers
 * stay backend-agnostic.
 */
export class SdkNormalizer implements Normalizer {
  private apiKeySource: string | undefined;
  private accumulatedThinking = "";
  private lastThinkingLine = "";

  consume(message: unknown): AgentEvent[] {
    const msg = message as any;

    if (msg.type === "system" && msg.subtype === "init") {
      // apiKeySource names which credential served the session ('oauth' is
      // Claude Code's own login). Recording it is what makes a silent switch
      // of credential visible after the fact.
      if (typeof msg.apiKeySource === "string") this.apiKeySource = msg.apiKeySource;
      return [{ type: "session", backendSessionId: msg.session_id }];
    }

    if (msg.type === "stream_event") {
      return this.consumeStreamEvent(msg.event);
    }

    if (msg.type === "tool_use_summary") {
      // The SDK provides a ready-made human-readable summary (e.g. "Read foo.ts").
      // (Older code read tool_name/tool_input, which this event does not carry.)
      return msg.summary ? [{ type: "tool", name: "tool", summary: truncate(msg.summary, 70) }] : [];
    }

    if (msg.type === "tool_progress") {
      // Carries only tool_use_id/tool_name/elapsed_time — no displayable content,
      // and fires repeatedly. tool_use_summary already covers tool activity.
      return [];
    }

    if (msg.type === "system" && msg.subtype === "compact_boundary") {
      // Long sessions compact silently; surface it so the transcript records
      // that history was summarized and how much was dropped.
      const meta = msg.compact_metadata ?? {};
      const trigger = meta.trigger === "manual" ? "manual" : "auto";
      const pre = meta.pre_tokens ?? 0;
      const post = meta.post_tokens;
      const shrink = post !== undefined ? `${pre} → ${post} tokens` : `${pre} tokens`;
      return [{ type: "thinking", delta: `context compacted (${trigger}, ${shrink})` }];
    }

    if (msg.type === "system") {
      // Subagent/task lifecycle (subtype init handled above).
      if (msg.subtype === "task_started" && msg.description) {
        return [{ type: "tool", name: "task", summary: truncate(msg.description, 60) }];
      }
      if (msg.subtype === "task_progress" && msg.last_tool_name) {
        return [{ type: "tool", name: msg.last_tool_name, summary: msg.summary || msg.last_tool_name }];
      }
      return [];
    }

    if (msg.type === "result") {
      return [this.consumeResult(msg)];
    }

    return [];
  }

  private consumeStreamEvent(event: any): AgentEvent[] {
    if (event?.type === "content_block_delta") {
      const delta = event.delta;
      if (delta?.type === "text_delta" && delta.text) {
        return [{ type: "text", delta: delta.text }];
      }
      if (delta?.type === "thinking_delta" && delta.thinking) {
        return this.consumeThinkingDelta(delta.thinking);
      }
      return [];
    }
    if (event?.type === "content_block_start" && event.content_block?.type === "thinking") {
      this.accumulatedThinking = "";
      this.lastThinkingLine = "";
      return [{ type: "thinking", delta: "thinking..." }];
    }
    if (event?.type === "content_block_stop") {
      this.accumulatedThinking = "";
      this.lastThinkingLine = "";
      return [];
    }
    return [];
  }

  /** Emit a thinking line only on a newline boundary (the last COMPLETE line). */
  private consumeThinkingDelta(thinking: string): AgentEvent[] {
    this.accumulatedThinking += thinking;
    const lines = this.accumulatedThinking.split("\n");
    if (lines.length > 1) {
      const completeLine = lines[lines.length - 2]?.trim();
      if (completeLine && completeLine !== this.lastThinkingLine) {
        this.lastThinkingLine = completeLine;
        return [{ type: "thinking", delta: truncate(completeLine, 70) }];
      }
    }
    return [];
  }

  private consumeResult(msg: any): AgentEvent {
    const deadTurn = msg.terminal_reason as string | undefined;
    if (!msg.is_error && deadTurn && deadTurn in DEAD_TURNS) {
      return {
        type: "error",
        message: (msg.errors?.join(", ") as string) || `turn ended: ${deadTurn}`,
        retryable: false,
        failover: DEAD_TURNS[deadTurn],
        terminalReason: deadTurn,
      };
    }
    if (!msg.is_error) {
      return {
        type: "result",
        text: (msg.result as string) || "",
        usage: { costUsd: msg.total_cost_usd ?? 0, turns: msg.num_turns ?? 0 },
        backendSessionId: msg.session_id ?? "",
        terminalReason: msg.terminal_reason,
        ...(msg.structured_output === undefined ? {} : { structured: msg.structured_output }),
        metadata: {
          cost_usd: msg.total_cost_usd,
          turns: msg.num_turns,
          duration_ms: msg.duration_ms,
          duration_api_ms: msg.duration_api_ms,
          stop_reason: msg.stop_reason,
          terminal_reason: msg.terminal_reason,
          session_id: msg.session_id,
          subtype: msg.subtype,
          api_key_source: this.apiKeySource,
          usage: msg.usage,
          model_usage: attribute(msg.modelUsage),
        },
      };
    }
    const raw = describeFailure(msg);
    // A transient error carries no scope yet — it only becomes one once the
    // session has burned its retries.
    return {
      type: "error",
      message: raw,
      retryable: isRetryable(raw),
      // api_error_status is the reliable signal; prose is the fallback.
      failover: scopeOf(
        { ...parseFailure(raw), status: typeof msg.api_error_status === "number" ? msg.api_error_status : undefined },
        "provider",
      ),
      terminalReason: msg.terminal_reason,
    };
  }
}
