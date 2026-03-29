import { query, type Query } from "@anthropic-ai/claude-agent-sdk";
// @ts-ignore — SDK re-exports this type but tsc can't resolve the path under Bun
import type { MessageParam } from "@anthropic-ai/sdk/resources";
import { existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { randomUUID } from "crypto";
import { buildSystemPrompt } from "./identity";
import { getAgentDefinitions } from "../core/agents";
import { Session, Message, ActiveEngine } from "../db/models";
import type { Attachment, SendResult, StreamCallback, ActivityCallback, SendCallbacks, ChatEngine, EngineOptions } from "../types";
import { truncate, formatToolUse } from "../utils/format-activity";
import { log } from "../utils/log";

const IDLE_TIMEOUT = 10 * 60 * 1000; // 10 minutes
const LONG_RUNNING_WARN = 30 * 60 * 1000; // 30 minutes

interface SDKUserMessage {
  type: "user";
  message: MessageParam;
  parent_tool_use_id: null;
  session_id: string;
}

/** Convert provider-agnostic attachments to Anthropic content blocks. */
export function buildContentBlocks(text: string, attachments?: Attachment[]): MessageParam["content"] {
  if (!attachments?.length) return text;

  const blocks: Array<{ type: "text"; text: string } | { type: "image"; source: { type: "base64"; media_type: string; data: string } }> = [];

  for (const att of attachments) {
    if (att.type === "image") {
      blocks.push({
        type: "image",
        source: {
          type: "base64",
          media_type: att.mimeType,
          data: att.data.toString("base64"),
        },
      });
    } else if (att.type === "document") {
      const docText = att.data.toString("utf8");
      const label = att.filename ? `[${att.filename}]` : "[document]";
      blocks.push({ type: "text", text: `${label}\n${docText}` });
    }
  }

  if (text) {
    blocks.push({ type: "text", text });
  }

  return blocks as MessageParam["content"];
}

/**
 * Push-based async iterable for streaming user messages to the SDK.
 * Keeps the query subprocess alive between messages.
 */
class MessageStream {
  private queue: SDKUserMessage[] = [];
  private waiting: (() => void) | null = null;
  private done = false;

  push(text: string, attachments?: Attachment[]): void {
    this.queue.push({
      type: "user",
      message: { role: "user", content: buildContentBlocks(text, attachments) },
      parent_tool_use_id: null,
      session_id: "",
    });
    this.waiting?.();
  }

  end(): void {
    this.done = true;
    this.waiting?.();
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<SDKUserMessage> {
    while (true) {
      while (this.queue.length > 0) {
        yield this.queue.shift()!;
      }
      if (this.done) return;
      await new Promise<void>((r) => {
        this.waiting = r;
      });
      this.waiting = null;
    }
  }
}

interface PendingResult {
  userMessage: string;
  onStream: StreamCallback | null;
  onActivity: ActivityCallback | null;
  accumulatedText: string;
  accumulatedThinking: string;
  lastThinkingLine: string;
  resolve: (value: SendResult) => void;
  reject: (error: Error) => void;
}


function sessionFileExists(sessionId: string, cwd: string): boolean {
  // SDK stores sessions at ~/.claude/projects/<encoded-cwd>/<session-id>.jsonl
  const encoded = cwd.replace(/\//g, "-");
  const sessionFile = join(homedir(), ".claude", "projects", encoded, `${sessionId}.jsonl`);
  return existsSync(sessionFile);
}

export async function createChatEngine(opts: EngineOptions): Promise<ChatEngine> {
  const { room, channel, resume, mcpServers } = opts;
  const systemPrompt = buildSystemPrompt("chat", channel);
  const cwd = homedir();

  let sessionId: string | null = null;
  if (typeof resume === "string") {
    // Specific session ID provided
    sessionId = resume;
  } else if (resume) {
    sessionId = await Session.getLatest(room);
  }

  // Verify session file exists on disk before attempting resume
  if (sessionId && !sessionFileExists(sessionId, cwd)) {
    sessionId = null;
  }
  let stream: MessageStream | null = null;
  let queryHandle: Query | null = null;
  let pending: PendingResult | null = null;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let longRunningTimer: ReturnType<typeof setTimeout> | null = null;
  let longRunningWarned = false;
  let alive = false;

  function clearIdleTimer() {
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  }

  function resetIdleTimer() {
    clearIdleTimer();
    idleTimer = setTimeout(() => {
      if (pending) {
        // Don't tear down while a request is in flight
        log.warn({ room }, "idle timer fired while request pending, skipping teardown");
        return;
      }
      teardown();
    }, IDLE_TIMEOUT);
  }

  function clearLongRunningTimer() {
    if (longRunningTimer) {
      clearTimeout(longRunningTimer);
      longRunningTimer = null;
    }
    longRunningWarned = false;
  }

  function startLongRunningTimer() {
    clearLongRunningTimer();
    longRunningTimer = setTimeout(() => {
      if (pending) {
        longRunningWarned = true;
        log.warn({ room, elapsed: LONG_RUNNING_WARN / 1000 }, "engine request running for 30+ minutes");
      }
    }, LONG_RUNNING_WARN);
  }

  function teardown() {
    clearIdleTimer();
    clearLongRunningTimer();
    if (stream) {
      stream.end();
      stream = null;
    }
    if (queryHandle) {
      queryHandle.close();
      queryHandle = null;
    }
    alive = false;
  }

  function startQuery() {
    stream = new MessageStream();
    alive = true;

    const options: Record<string, unknown> = {
      systemPrompt,
      cwd,
      permissionMode: "bypassPermissions",
      includePartialMessages: true,
      settingSources: ["project", "user"],
    };

    if (sessionId) {
      options.resume = sessionId;
    } else {
      // Force a brand-new session with a unique ID so the claude subprocess
      // cannot auto-continue a prior session in the same CWD ($HOME).
      options.continue = false;
      options.sessionId = randomUUID();
    }

    if (mcpServers) {
      options.mcpServers = mcpServers;
    }

    const agentDefs = getAgentDefinitions();
    if (Object.keys(agentDefs).length > 0) {
      options.agents = agentDefs;
    }

    queryHandle = query({
      prompt: stream as any,
      options: options as any,
    });

    // Background consumer — runs for the lifetime of the query
    (async () => {
      try {
        for await (const message of queryHandle!) {
          if (message.type === "system" && message.subtype === "init") {
            const newId = message.session_id;
            if (!sessionId || newId !== sessionId) {
              sessionId = newId;
              await Session.create(sessionId, room);
            }

            if (pending) {
              await Message.save({
                sessionId,
                room,
                sender: "user",
                content: pending.userMessage,
                isFromAgent: false,
              });
            }
          }

          // Stream events: text deltas, thinking deltas, block lifecycle
          if (message.type === "stream_event" && pending) {
            const event = (message as any).event;

            if (event?.type === "content_block_delta") {
              const delta = event.delta;
              if (delta?.type === "text_delta" && delta.text) {
                pending.accumulatedText += delta.text;
                pending.onStream?.(pending.accumulatedText);
              }
              if (delta?.type === "thinking_delta" && delta.thinking) {
                pending.accumulatedThinking += delta.thinking;
                // Only update on complete lines (newline boundary)
                const lines = pending.accumulatedThinking.split("\n");
                if (lines.length > 1) {
                  // Show the last complete line (not the partial one being typed)
                  const completeLine = lines[lines.length - 2]?.trim();
                  if (completeLine && completeLine !== pending.lastThinkingLine) {
                    pending.lastThinkingLine = completeLine;
                    pending.onActivity?.(truncate(completeLine, 70));
                  }
                }
              }
            }

            if (event?.type === "content_block_start") {
              const block = event.content_block;
              if (block?.type === "thinking") {
                pending.accumulatedThinking = "";
                pending.lastThinkingLine = "";
                pending.onActivity?.("thinking...");
              }
              // tool_use: don't show here — wait for tool_use_summary with full input
            }

            if (event?.type === "content_block_stop") {
              pending.accumulatedThinking = "";
              pending.lastThinkingLine = "";
            }
          }

          if (message.type === "tool_use_summary" && pending) {
            const msg = message as any;
            const name = msg.tool_name || "tool";
            pending.onActivity?.(formatToolUse(name, msg.tool_input));
          }

          if (message.type === "tool_progress" && pending) {
            const msg = message as any;
            const toolName = msg.tool_name;
            const content = msg.content;
            if (toolName === "Bash" && content) {
              pending.onActivity?.(`$ ${truncate(content, 60)}`);
            } else if (content) {
              pending.onActivity?.(truncate(content, 70));
            }
          }

          // Task/agent lifecycle
          if (message.type === "system" && pending) {
            const msg = message as any;
            if (msg.subtype === "task_started" && msg.description) {
              pending.onActivity?.(truncate(msg.description, 60));
            }
            if (msg.subtype === "task_progress" && msg.last_tool_name) {
              pending.onActivity?.(msg.summary || msg.last_tool_name);
            }
          }

          if (message.type === "result" && pending) {
            if (!message.is_error) {
              const resultText = (message as any).result as string;
              const costUsd = (message as any).total_cost_usd as number;
              const turns = (message as any).num_turns as number;

              let messageId: number | undefined;
              if (sessionId && resultText) {
                messageId = await Message.save({
                  sessionId,
                  room,
                  sender: "nia",
                  content: resultText,
                  isFromAgent: true,
                  deliveryStatus: "pending",
                });
                await Session.touch(sessionId);
              }

              await ActiveEngine.unregister(room);
              clearLongRunningTimer();
              pending.resolve({ result: resultText, costUsd, turns, messageId });
              pending = null;
              resetIdleTimer();
            } else {
              const errors = (message as any).errors;
              const errorText = `[error] ${errors?.join(", ") || "unknown error"}`;
              await ActiveEngine.unregister(room);
              clearLongRunningTimer();
              pending.resolve({ result: errorText, costUsd: 0, turns: 0 });
              pending = null;
              resetIdleTimer();
            }
          }
        }

        // Stream ended without a result — subprocess exited or was killed
        if (pending) {
          const partial = pending.accumulatedText;
          log.error({ room, partialChars: partial.length }, "query stream ended without result, rejecting pending request");
          await ActiveEngine.unregister(room).catch(() => {});
          pending.reject(new Error(`stream ended without result (${partial.length} chars accumulated)`));
          pending = null;
        }
      } catch (err) {
        if (pending) {
          await ActiveEngine.unregister(room).catch(() => {});
          pending.reject(err instanceof Error ? err : new Error(String(err)));
          pending = null;
        }
      } finally {
        clearLongRunningTimer();
        alive = false;
        stream = null;
        queryHandle = null;
      }
    })();
  }

  return {
    get sessionId() {
      return sessionId;
    },

    get room() {
      return room;
    },

    async send(userMessage: string, callbacks?: SendCallbacks, attachments?: Attachment[]) {
      // Clear idle timer — engine is not idle while processing a request
      clearIdleTimer();
      startLongRunningTimer();

      await ActiveEngine.register(room, channel);

      if (!alive || !stream) {
        startQuery();
      }

      return new Promise<SendResult>((resolve, reject) => {
        pending = {
          userMessage,
          onStream: callbacks?.onStream || null,
          onActivity: callbacks?.onActivity || null,
          accumulatedText: "",
          accumulatedThinking: "",
          lastThinkingLine: "",
          resolve,
          reject,
        };
        stream!.push(userMessage, attachments);
      });
    },

    close() {
      teardown();
      ActiveEngine.unregister(room).catch(() => {});
    },
  };
}
