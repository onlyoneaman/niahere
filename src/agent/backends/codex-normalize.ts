import type { AgentEvent, Normalizer } from "../types";
import { truncate } from "../../utils/format-activity";
import { scopeOf, parseFailure } from "../failure";
import { estimateCodexCost } from "../pricing";

/**
 * Pure reducer: Codex `codex exec --json` JSONL events → normalized `AgentEvent`s.
 *
 * Codex is batch (no token streaming): the assistant message arrives whole in a
 * single `item.completed`/`agent_message`, and `turn.completed` carries token
 * usage. So `text` is emitted once (full), then `result` on `turn.completed`.
 * No I/O — the session that drives it owns process lifecycle. A failed turn
 * arrives as a top-level `error` and/or `turn.failed` carrying the upstream
 * message; `error` *items* are non-fatal warnings (service tier, model metadata,
 * skill budget) and are dropped.
 */
export class CodexNormalizer implements Normalizer {
  /** The model this run was launched on, for usage attribution — codex's own
   *  events don't name it. */
  constructor(private readonly model?: string) {}

  private threadId = "";
  private agentText = "";
  private failed = false;

  get backendSessionId(): string {
    return this.threadId;
  }

  consume(message: unknown): AgentEvent[] {
    const e = message as any;
    switch (e.type) {
      case "thread.started":
        this.threadId = e.thread_id ?? "";
        return this.threadId ? [{ type: "session", backendSessionId: this.threadId }] : [];
      case "item.started":
      case "item.completed":
        return this.consumeItem(e.type === "item.completed", e.item);
      case "error":
        return this.fail(typeof e.message === "string" ? e.message : "");
      case "turn.failed":
        return this.fail(typeof e.error?.message === "string" ? e.error.message : "");
      case "turn.completed": {
        // Codex counts like OpenAI: `input_tokens` is the whole prompt with
        // `cached_input_tokens` a slice of it. Claude reports the two as
        // siblings and one accumulator sums both, so the slice comes out here.
        const cacheRead = e.usage?.cached_input_tokens ?? 0;
        const input = Math.max(0, (e.usage?.input_tokens ?? 0) - cacheRead);
        const output = e.usage?.output_tokens ?? 0;
        const estimated = estimateCodexCost(this.model, {
          inputTokens: input,
          outputTokens: output,
          cacheReadInputTokens: cacheRead,
          cacheCreationInputTokens: e.usage?.cache_write_input_tokens ?? 0,
        });
        return [
          {
            type: "result",
            text: this.agentText,
            usage: { tokens: { input, output } },
            backendSessionId: this.threadId,
            // Same shape the Claude path emits, so one accumulator serves both
            // and a failed-over turn is attributable to the provider that ran it.
            // No cost: codex reports none, and an invented zero would read as a
            // free turn.
            metadata: {
              model_usage: {
                [this.model || "default"]: {
                  provider: "codex",
                  inputTokens: input,
                  outputTokens: output,
                  cacheReadInputTokens: cacheRead,
                  cacheCreationInputTokens: e.usage?.cache_write_input_tokens ?? 0,
                  // What the API would have charged. Deliberately not `costUSD`:
                  // the subscription covers these tokens, so this is a
                  // projection and must never be added to a reported bill.
                  ...(estimated === null ? {} : { estimatedCostUSD: estimated }),
                },
              },
            },
          },
        ];
      }
      default:
        return [];
    }
  }

  /** Codex reports the same failure twice (`error` then `turn.failed`); only the
   *  first ends the turn. */
  private fail(raw: string): AgentEvent[] {
    if (this.failed) return [];
    this.failed = true;
    const failure = parseFailure(raw);
    return [{ type: "error", message: failure.message, retryable: false, failover: scopeOf(failure) }];
  }

  private consumeItem(completed: boolean, item: any): AgentEvent[] {
    if (!item) return [];
    switch (item.type) {
      case "command_execution":
        // Surface the command as activity once, when it starts.
        if (!completed && item.command)
          return [{ type: "tool", name: "command", summary: truncate(String(item.command), 70) }];
        return [];
      case "mcp_tool_call": {
        if (completed) return [];
        const name = item.server ? `${item.server}.${item.tool ?? "tool"}` : item.tool || "mcp";
        return [{ type: "tool", name, summary: item.tool }];
      }
      case "reasoning":
        if (completed && item.text) return [{ type: "thinking", delta: truncate(String(item.text), 70) }];
        return [];
      case "agent_message":
        if (completed && typeof item.text === "string") {
          this.agentText = item.text;
          return [{ type: "text", delta: item.text }];
        }
        return [];
      default:
        return [];
    }
  }
}
