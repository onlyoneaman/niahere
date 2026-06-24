import type { AgentEvent, Normalizer } from "../types";
import { truncate } from "../../utils/format-activity";

/**
 * Pure reducer: Codex `codex exec --json` JSONL events → normalized `AgentEvent`s.
 *
 * Codex is batch (no token streaming): the assistant message arrives whole in a
 * single `item.completed`/`agent_message`, and `turn.completed` carries token
 * usage. So `text` is emitted once (full), then `result` on `turn.completed`.
 * No I/O — the session that drives it owns process lifecycle. Real errors are
 * detected from the process exit code by the session, not here (Codex `error`
 * items are often non-fatal warnings).
 */
export class CodexNormalizer implements Normalizer {
  private threadId = "";
  private agentText = "";

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
      case "turn.completed":
        return [
          {
            type: "result",
            text: this.agentText,
            usage: {
              tokens: {
                input: e.usage?.input_tokens ?? 0,
                output: e.usage?.output_tokens ?? 0,
              },
            },
            backendSessionId: this.threadId,
          },
        ];
      default:
        return [];
    }
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
