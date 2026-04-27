import { query, type Query } from "@anthropic-ai/claude-agent-sdk";
// @ts-ignore — SDK re-exports this type but tsc can't resolve the path under Bun
import type { MessageParam } from "@anthropic-ai/sdk/resources";
import { existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { randomUUID } from "crypto";
import { buildSystemPrompt, buildContextSuffix, getSessionContext } from "./identity";
import { buildEmployeePrompt } from "./employee-prompt";
import { getEmployee } from "../core/employees";
import { getAgentDefinitions, scanAgents } from "../core/agents";
import { Session, Message, ActiveEngine, Job } from "../db/models";
import type {
  Attachment,
  SendResult,
  StreamCallback,
  ActivityCallback,
  SendCallbacks,
  ChatEngine,
  EngineOptions,
} from "../types";
import { truncate, formatToolUse } from "../utils/format-activity";
import { finalizeSession, cancelPending } from "../core/finalizer";
import { log } from "../utils/log";
import { isRetryableApiError, sleep } from "../utils/retry";

const IDLE_TIMEOUT = 10 * 60 * 1000; // 10 minutes
const LONG_RUNNING_WARN = 30 * 60 * 1000; // 30 minutes
const MAX_SEND_RETRIES = 2;
const SEND_RETRY_DELAYS = [3_000, 8_000];

interface SDKUserMessage {
  type: "user";
  message: MessageParam;
  parent_tool_use_id: null;
  session_id: string;
}

/** Convert provider-agnostic attachments to Anthropic content blocks. */
export function buildContentBlocks(text: string, attachments?: Attachment[]): MessageParam["content"] {
  if (!attachments?.length) return text;

  const blocks: Array<
    | { type: "text"; text: string }
    | {
        type: "image";
        source: { type: "base64"; media_type: string; data: string };
      }
  > = [];

  const pathHints = attachments
    .map((att, idx) => {
      if (!att.sourcePath) return "";
      const label = att.filename || `${att.type}-${idx + 1}`;
      return `- ${idx + 1}. ${label} (${att.type}, ${att.mimeType}) -> ${att.sourcePath}`;
    })
    .filter(Boolean);

  if (pathHints.length > 0) {
    blocks.push({
      type: "text",
      text:
        "[Attachment local paths]\n" +
        "Use these absolute paths to inspect attachments. To resend/forward one, call send_message with media_path set to its path.\n" +
        pathHints.join("\n"),
    });
  }

  for (const att of attachments) {
    if (att.sourcePath) continue;

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
  userSaved: boolean;
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
  let systemPrompt = buildSystemPrompt("chat", channel);

  // Inject recent session summaries for continuity
  const sessionContext = await getSessionContext(room);
  if (sessionContext) {
    systemPrompt += "\n\n" + sessionContext;
  }

  // Context overrides: employee > agent > job > default
  let cwd = homedir();
  if (opts.employee) {
    const empPrompt = buildEmployeePrompt(opts.employee);
    if (empPrompt) systemPrompt = empPrompt;
    const emp = getEmployee(opts.employee);
    if (emp?.repo && existsSync(emp.repo)) cwd = emp.repo;
  } else if (opts.agent) {
    const agents = scanAgents();
    const agentDef = agents.find((a) => a.name === opts.agent);
    if (agentDef) systemPrompt = agentDef.body + "\n\n" + buildContextSuffix("chat");
  } else if (opts.job) {
    // Job chat: load job and use its context
    const jobData = await Job.get(opts.job);
    if (jobData) {
      // If job has an employee, use employee prompt
      if (jobData.employee) {
        const empPrompt = buildEmployeePrompt(jobData.employee);
        if (empPrompt) systemPrompt = empPrompt;
        const emp = getEmployee(jobData.employee);
        if (emp?.repo && existsSync(emp.repo)) cwd = emp.repo;
      } else if (jobData.agent) {
        // If job has an agent, use agent prompt + context
        const agents = scanAgents();
        const agentDef = agents.find((a) => a.name === jobData.agent);
        if (agentDef) systemPrompt = agentDef.body + "\n\n" + buildContextSuffix("chat");
      }
      systemPrompt += `\n\n## Job Context\nYou are chatting in the context of job "${jobData.name}" (schedule: ${jobData.schedule}).\n\nJob prompt:\n${jobData.prompt}`;
    }
  }

  // Watch mode: inject behavior into system prompt
  if (opts.watchBehavior) {
    const { channel: watchChannel, behavior } = opts.watchBehavior;
    systemPrompt += `\n\n## Watch Mode — #${watchChannel}\n\nYou are monitoring this Slack channel. Follow the behavior instructions below.\nRespond with [NO_REPLY] if no action is needed — do not explain why.\n\n${behavior}`;
  }

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
  let messageCount = 0;
  let retryCount = 0;

  function clearIdleTimer() {
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  }

  function resetIdleTimer() {
    clearIdleTimer();
    idleTimer = setTimeout(async () => {
      if (pending) {
        // Don't tear down while a request is in flight
        log.warn({ room }, "idle timer fired while request pending, skipping teardown");
        return;
      }
      // Enqueue finalization before "sleep"
      if (sessionId && messageCount > 0) {
        finalizeSession(sessionId, room).catch((err) => {
          log.error({ err, room }, "finalization enqueue failed during idle teardown");
        });
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

            if (pending && !pending.userSaved) {
              await Message.save({
                sessionId,
                room,
                sender: "user",
                content: pending.userMessage,
                isFromAgent: false,
              });
              pending.userSaved = true;
              messageCount++;
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
            const msg = message as any;
            if (!message.is_error) {
              const resultText = msg.result as string;
              const costUsd = msg.total_cost_usd as number;
              const turns = msg.num_turns as number;

              const metadata: Record<string, unknown> = {
                cost_usd: costUsd,
                turns,
                duration_ms: msg.duration_ms,
                duration_api_ms: msg.duration_api_ms,
                stop_reason: msg.stop_reason,
                terminal_reason: msg.terminal_reason,
                session_id: msg.session_id,
                subtype: msg.subtype,
                usage: msg.usage,
                model_usage: msg.modelUsage,
              };

              let messageId: number | undefined;
              if (sessionId && resultText) {
                const saveParams = {
                  sessionId,
                  room,
                  sender: "nia",
                  content: resultText,
                  isFromAgent: true,
                  deliveryStatus: "pending" as const,
                  metadata,
                };
                try {
                  messageId = await Message.save(saveParams);
                } catch {
                  messageId = await Message.save({
                    ...saveParams,
                    metadata: undefined,
                  });
                }
                await Session.touch(sessionId);
                Session.accumulateMetadata(sessionId, {
                  ...metadata,
                  channel,
                }).catch(() => {});
              }

              await ActiveEngine.unregister(room);
              clearLongRunningTimer();
              retryCount = 0;
              pending.resolve({
                result: resultText,
                costUsd,
                turns,
                messageId,
              });
              pending = null;
              resetIdleTimer();
            } else {
              const errors = msg.errors;
              const rawError = errors?.join(", ") || "unknown error";

              // Retry on transient API errors (500, overloaded, rate-limit)
              if (retryCount < MAX_SEND_RETRIES && isRetryableApiError(rawError)) {
                const delay = SEND_RETRY_DELAYS[retryCount] ?? 8_000;
                retryCount++;
                log.warn(
                  { room, attempt: retryCount, error: rawError, delayMs: delay },
                  "retrying chat send after transient API error",
                );
                const retryPending = pending;
                pending = null;
                clearLongRunningTimer();

                // Tear down current query and restart after delay
                teardown();
                await sleep(delay);
                startQuery();

                // Re-send: the user message is already saved in DB, so mark it saved
                pending = {
                  ...retryPending,
                  userSaved: true,
                  accumulatedText: "",
                  accumulatedThinking: "",
                  lastThinkingLine: "",
                };
                retryPending.onActivity?.("retrying after API error...");
                stream!.push(retryPending.userMessage);
              } else {
                const errorText = `[error] ${rawError}`;
                await ActiveEngine.unregister(room);
                clearLongRunningTimer();
                pending.resolve({ result: errorText, costUsd: 0, turns: 0 });
                pending = null;
                retryCount = 0;
                resetIdleTimer();
              }
            }
          }
        }

        // Stream ended without a result — subprocess exited or was killed
        if (pending) {
          const partial = pending.accumulatedText;
          log.error(
            { room, partialChars: partial.length },
            "query stream ended without result, rejecting pending request",
          );
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

      // Cancel any pending finalization — session is active again
      if (sessionId) {
        cancelPending(sessionId).catch(() => {});
      }

      await ActiveEngine.register(room, channel);

      if (!alive || !stream) {
        startQuery();
      }

      // Save user message to DB if session already exists (resumed session).
      // For new sessions, the init handler saves it once sessionId is known.
      let userSaved = false;
      if (sessionId) {
        await Message.save({
          sessionId,
          room,
          sender: "user",
          content: userMessage,
          isFromAgent: false,
        });
        await Session.touch(sessionId);
        userSaved = true;
        messageCount++;
      }

      return new Promise<SendResult>((resolve, reject) => {
        pending = {
          userMessage,
          userSaved,
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

    async close() {
      // Enqueue finalization — processed by daemon or inline if we are the daemon
      if (sessionId && messageCount > 0 && !pending) {
        try {
          await finalizeSession(sessionId, room);
        } catch (err) {
          log.error({ err, room }, "finalization enqueue failed during close");
        }
      }
      teardown();
      await ActiveEngine.unregister(room).catch(() => {});
    },
  };
}
