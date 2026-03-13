import { query, type Query } from "@anthropic-ai/claude-agent-sdk";
import { existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { buildSystemPrompt } from "./identity";
import { Session, Message, ActiveEngine } from "../db/models";

const IDLE_TIMEOUT = 10 * 60 * 1000; // 10 minutes

export interface SendResult {
  result: string;
  costUsd: number;
  turns: number;
}

export type StreamCallback = (textSoFar: string) => void;
export type ActivityCallback = (status: string) => void;

export interface SendCallbacks {
  onStream?: StreamCallback;
  onActivity?: ActivityCallback;
}

export interface ChatEngine {
  sessionId: string | null;
  room: string;
  send(userMessage: string, callbacks?: SendCallbacks): Promise<SendResult>;
  close(): void;
}

export interface EngineOptions {
  room: string;
  channel: string;
  resume: boolean;
}

interface SDKUserMessage {
  type: "user";
  message: { role: "user"; content: string };
  parent_tool_use_id: null;
  session_id: string;
}

/**
 * Push-based async iterable for streaming user messages to the SDK.
 * Keeps the query subprocess alive between messages.
 */
class MessageStream {
  private queue: SDKUserMessage[] = [];
  private waiting: (() => void) | null = null;
  private done = false;

  push(text: string): void {
    this.queue.push({
      type: "user",
      message: { role: "user", content: text },
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
  resolve: (value: SendResult) => void;
  reject: (error: Error) => void;
}

function truncate(s: string, max: number): string {
  const oneline = s.replace(/\n/g, " ").trim();
  return oneline.length > max ? oneline.slice(0, max) + "…" : oneline;
}

function formatToolUse(tool: string, input: any): string {
  if (!input || typeof input !== "object") return tool;

  switch (tool) {
    case "Bash":
      return input.command ? `$ ${truncate(input.command, 50)}` : "running command";
    case "Read":
      return input.file_path ? `reading ${basename(input.file_path)}` : "reading file";
    case "Edit":
      return input.file_path ? `editing ${basename(input.file_path)}` : "editing file";
    case "Write":
      return input.file_path ? `writing ${basename(input.file_path)}` : "writing file";
    case "Grep":
      return input.pattern ? `searching: ${truncate(input.pattern, 40)}` : "searching";
    case "Glob":
      return input.pattern ? `finding: ${truncate(input.pattern, 40)}` : "finding files";
    case "Agent":
    case "Task":
      return input.description || input.prompt?.slice(0, 40) || "running agent";
    case "WebFetch":
      return input.url ? `fetching ${truncate(input.url, 50)}` : "fetching";
    case "WebSearch":
      return input.query ? `searching: ${truncate(input.query, 40)}` : "searching web";
    default: {
      const val = input.command || input.pattern || input.query || input.file_path || input.description || "";
      return val ? `${tool} ${truncate(String(val), 50)}` : tool;
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
  const { room, channel, resume } = opts;
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

          // Stream events: text deltas + block lifecycle
          if (message.type === "stream_event" && pending) {
            const event = (message as any).event;
            if (event?.type === "content_block_delta" && event.delta?.type === "text_delta" && event.delta.text) {
              pending.accumulatedText += event.delta.text;
              pending.onStream?.(pending.accumulatedText);
            }
            if (event?.type === "content_block_start") {
              const blockType = event.content_block?.type;
              if (blockType === "thinking") pending.onActivity?.("thinking");
              if (blockType === "text") pending.onActivity?.("writing");
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
              const resultText = message.result;
              const costUsd = message.total_cost_usd;
              const turns = message.num_turns;

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

    async send(userMessage: string, callbacks?: SendCallbacks) {
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
          resolve,
          reject,
        };
        stream!.push(userMessage);
      });
    },

    close() {
      teardown();
      ActiveEngine.unregister(room).catch(() => {});
    },
  };
}
