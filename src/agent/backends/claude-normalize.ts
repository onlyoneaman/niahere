import type { AgentEvent, Normalizer } from "../types";
import { truncate, formatToolUse } from "../../utils/format-activity";
import { isRetryableApiError, isProviderDownError } from "../../utils/retry";

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
      return [
        {
          type: "tool",
          name: msg.tool_name || "tool",
          summary: formatToolUse(msg.tool_name || "tool", msg.tool_input),
        },
      ];
    }

    if (msg.type === "tool_progress") {
      if (msg.tool_name === "Bash" && msg.content) {
        return [{ type: "tool", name: "Bash", summary: `$ ${truncate(msg.content, 60)}` }];
      }
      if (msg.content) {
        return [{ type: "tool", name: msg.tool_name || "tool", summary: truncate(msg.content, 70) }];
      }
      return [];
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
    // Two INDEPENDENT predicates from the same raw string:
    //  - retryable: transient API failure → the session may retry internally.
    //  - providerDown: blank/"unknown error" → the provider is down → failover.
    return {
      type: "error",
      message: raw,
      retryable: isRetryableApiError(raw),
      providerDown: isProviderDownError(raw),
      terminalReason: msg.terminal_reason,
    };
  }
}
