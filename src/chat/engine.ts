import { query, type Query } from "@anthropic-ai/claude-agent-sdk";
// @ts-ignore — SDK re-exports this type but tsc can't resolve the path under Bun
import type { MessageParam } from "@anthropic-ai/sdk/resources";
import { existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { randomUUID } from "crypto";
import { buildSystemPrompt } from "./identity";
import { Session, Message, ActiveEngine } from "../db/models";
import type { Attachment, SendResult, StreamCallback, ActivityCallback, SendCallbacks, ChatEngine, EngineOptions } from "../types";

const IDLE_TIMEOUT = 10 * 60 * 1000; // 10 minutes

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

function truncate(s: string, max: number): string {
  const oneline = s.replace(/\n/g, " ").trim();
  return oneline.length > max ? oneline.slice(0, max) + "…" : oneline;
}

function formatToolUse(tool: string, input: any): string {
  if (!input || typeof input !== "object") return tool.toLowerCase();

  switch (tool) {
    // File operations
    case "Bash":
      return input.description
        ? truncate(input.description, 60)
        : input.command ? `$ ${truncate(input.command, 55)}` : "running command";
    case "Read":
      return input.file_path ? `reading ${basename(input.file_path)}` : "reading file";
    case "Edit":
      return input.file_path ? `editing ${basename(input.file_path)}` : "editing file";
    case "Write":
      return input.file_path ? `writing ${basename(input.file_path)}` : "writing file";
    case "NotebookEdit":
      return input.file_path ? `editing notebook ${basename(input.file_path)}` : "editing notebook";

    // Search operations
    case "Grep":
      return input.pattern ? `searching for "${truncate(input.pattern, 35)}"` : "searching code";
    case "Glob":
      return input.pattern ? `finding ${truncate(input.pattern, 40)}` : "finding files";
    case "ToolSearch":
      return input.query ? `looking up tool: ${truncate(input.query, 40)}` : "searching tools";

    // Agent & task operations
    case "Agent":
      return input.description ? `⟩ ${truncate(input.description, 55)}` : "running agent";
    case "Task":
      return input.description || input.prompt?.slice(0, 50) || "running task";
    case "TaskCreate":
      return input.description ? `starting: ${truncate(input.description, 45)}` : "creating task";
    case "TaskGet":
    case "TaskOutput":
      return "checking task progress";
    case "TaskList":
      return "listing tasks";
    case "TaskStop":
      return "stopping task";
    case "TaskUpdate":
      return "updating task";
    case "SendMessage":
      return input.to ? `messaging ${truncate(String(input.to), 30)}` : "sending message";

    // Web operations
    case "WebFetch":
      return input.url ? `fetching ${truncate(input.url, 50)}` : "fetching url";
    case "WebSearch":
      return input.query ? `web search: ${truncate(input.query, 40)}` : "searching the web";

    // Planning & workflow
    case "EnterPlanMode":
      return "entering plan mode";
    case "ExitPlanMode":
      return "exiting plan mode";
    case "EnterWorktree":
      return "creating worktree";
    case "ExitWorktree":
      return "leaving worktree";

    // Skill & todo
    case "Skill":
      return input.skill ? `using /${truncate(input.skill, 40)}` : "invoking skill";
    case "TodoWrite":
    case "TodoRead":
      return tool === "TodoWrite" ? "updating checklist" : "reading checklist";

    // LSP
    case "LSP":
      return input.command ? `lsp: ${truncate(input.command, 50)}` : "querying language server";

    // MCP tools (plugin_name__tool_name pattern)
    default: {
      // Handle MCP tools like mcp__playwright__browser_navigate
      if (tool.startsWith("mcp__")) {
        const parts = tool.split("__");
        const action = parts[parts.length - 1]?.replace(/_/g, " ") || tool;
        const val = input.url || input.selector || input.text || input.value || "";
        return val ? `${action}: ${truncate(String(val), 40)}` : action;
      }
      const val = input.description || input.command || input.pattern || input.query || input.file_path || "";
      return val ? `${tool.toLowerCase()}: ${truncate(String(val), 50)}` : tool.toLowerCase();
    }
  }
}

function basename(path: string): string {
  return path.split("/").pop() || path;
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

  let sessionId = resume ? await Session.getLatest(room) : null;

  // Verify session file exists on disk before attempting resume
  if (sessionId && !sessionFileExists(sessionId, cwd)) {
    sessionId = null;
  }
  let stream: MessageStream | null = null;
  let queryHandle: Query | null = null;
  let pending: PendingResult | null = null;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let alive = false;

  function resetIdleTimer() {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      teardown();
    }, IDLE_TIMEOUT);
  }

  function teardown() {
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
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

              if (sessionId && resultText) {
                await Message.save({
                  sessionId,
                  room,
                  sender: "nia",
                  content: resultText,
                  isFromAgent: true,
                });
                await Session.touch(sessionId);
              }

              await ActiveEngine.unregister(room);
              pending.resolve({ result: resultText, costUsd, turns });
              pending = null;
              resetIdleTimer();
            } else {
              const errors = (message as any).errors;
              const errorText = `[error] ${errors?.join(", ") || "unknown error"}`;
              await ActiveEngine.unregister(room);
              pending.resolve({ result: errorText, costUsd: 0, turns: 0 });
              pending = null;
              resetIdleTimer();
            }
          }
        }
      } catch (err) {
        if (pending) {
          await ActiveEngine.unregister(room).catch(() => {});
          pending.reject(err instanceof Error ? err : new Error(String(err)));
          pending = null;
        }
      } finally {
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
