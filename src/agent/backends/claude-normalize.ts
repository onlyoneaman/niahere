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
  budget_exhausted: undefined,
  malformed_tool_use_exhausted: undefined,
  structured_output_retry_exhausted: undefined,
  tool_deferred_unavailable: undefined,
  turn_setup_failed: undefined,
};

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
  private accumulatedThinking = "";
  private lastThinkingLine = "";

  consume(message: unknown): AgentEvent[] {
    const msg = message as any;

    if (msg.type === "system" && msg.subtype === "init") {
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
        metadata: {
          cost_usd: msg.total_cost_usd,
          turns: msg.num_turns,
          duration_ms: msg.duration_ms,
          duration_api_ms: msg.duration_api_ms,
          stop_reason: msg.stop_reason,
          terminal_reason: msg.terminal_reason,
          session_id: msg.session_id,
          subtype: msg.subtype,
          usage: msg.usage,
          model_usage: msg.modelUsage,
        },
      };
    }
    const raw = (msg.errors?.join(", ") as string) || "unknown error";
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
