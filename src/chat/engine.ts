import { query, type Query } from "@anthropic-ai/claude-agent-sdk";
import { buildSystemPrompt } from "./identity";
import { Session, Message, ActiveEngine } from "../db/models";

const IDLE_TIMEOUT = 10 * 60 * 1000; // 10 minutes

export interface SendResult {
  result: string;
  costUsd: number;
  turns: number;
}

export type StreamCallback = (textSoFar: string) => void;

export interface ChatEngine {
  sessionId: string | null;
  room: string;
  send(userMessage: string, onStream?: StreamCallback): Promise<SendResult>;
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
  accumulatedText: string;
  resolve: (value: SendResult) => void;
  reject: (error: Error) => void;
}

export async function createChatEngine(workspace: string, opts: EngineOptions): Promise<ChatEngine> {
  const systemPrompt = buildSystemPrompt(workspace);
  const { room, channel, resume } = opts;

  let sessionId = resume ? await Session.getLatest(room) : null;
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
      cwd: workspace,
      permissionMode: "bypassPermissions",
      includePartialMessages: true,
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

          // Stream text deltas to caller
          if (message.type === "stream_event" && pending?.onStream) {
            const event = (message as any).event;
            if (event?.type === "content_block_delta" && event.delta?.type === "text_delta" && event.delta.text) {
              pending.accumulatedText += event.delta.text;
              pending.onStream(pending.accumulatedText);
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

    async send(userMessage: string, onStream?: StreamCallback) {
      await ActiveEngine.register(room, channel);

      if (!alive || !stream) {
        startQuery();
      }

      return new Promise<SendResult>((resolve, reject) => {
        pending = { userMessage, onStream: onStream || null, accumulatedText: "", resolve, reject };
        stream!.push(userMessage);
      });
    },

    close() {
      teardown();
      ActiveEngine.unregister(room).catch(() => {});
    },
  };
}
