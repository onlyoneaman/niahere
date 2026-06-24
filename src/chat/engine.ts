import { existsSync } from "fs";
import { homedir } from "os";
import { buildSystemPrompt, buildContextSuffix, getSessionContext } from "./identity";
import { buildEmployeePrompt } from "./employee-prompt";
import { getEmployee } from "../core/employees";
import { getAgentDefinitions, scanAgents } from "../core/agents";
import { Session, Message, ActiveEngine, Job } from "../db/models";
import type { Attachment, SendResult, SendCallbacks, ChatEngine, EngineOptions } from "../types";
import { finalizeSession, cancelPending } from "../core/finalizer";
import { log } from "../utils/log";
import { registerActiveHandle, unregisterActiveHandle } from "../core/active-handles";
import { resolveJobPrompt } from "../core/job-prompt";
import { resolveBackends, type AgentSession } from "../agent";

const IDLE_TIMEOUT = 10 * 60 * 1000; // 10 minutes
const LONG_RUNNING_WARN = 30 * 60 * 1000; // 30 minutes
const GENERIC_CHAT_ERROR = "💀";

/** Convert backend error text into a channel-safe chat response. */
export function formatChatError(rawError: string | null | undefined): string {
  const error = rawError?.trim();
  if (getChatErrorSignal(error) === "provider_down") {
    return GENERIC_CHAT_ERROR;
  }
  if (error === "oauth_org_not_allowed") {
    return "[error] This Claude account is not allowed to access the configured organization. Check your Claude login or organization access.";
  }
  return `[error] ${error}`;
}

export function getChatErrorSignal(rawError: string | null | undefined): SendResult["signal"] | undefined {
  const error = rawError?.trim();
  return !error || error.toLowerCase() === "unknown error" ? "provider_down" : undefined;
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
  let contextModel: string | null | undefined;
  if (opts.employee) {
    const empPrompt = buildEmployeePrompt(opts.employee);
    if (empPrompt) systemPrompt = empPrompt;
    const emp = getEmployee(opts.employee);
    contextModel = emp?.model;
    if (emp?.repo && existsSync(emp.repo)) cwd = emp.repo;
  } else if (opts.agent) {
    const agents = scanAgents();
    const agentDef = agents.find((a) => a.name === opts.agent);
    if (agentDef) {
      systemPrompt = agentDef.body + "\n\n" + buildContextSuffix("chat");
      contextModel = agentDef.model;
    }
  } else if (opts.job) {
    // Job chat: load job and use its context
    const jobData = await Job.get(opts.job);
    if (jobData) {
      contextModel = jobData.model;
      // If job has an employee, use employee prompt
      if (jobData.employee) {
        const empPrompt = buildEmployeePrompt(jobData.employee);
        if (empPrompt) systemPrompt = empPrompt;
        const emp = getEmployee(jobData.employee);
        if (!contextModel) contextModel = emp?.model;
        if (emp?.repo && existsSync(emp.repo)) cwd = emp.repo;
      } else if (jobData.agent) {
        // If job has an agent, use agent prompt + context
        const agents = scanAgents();
        const agentDef = agents.find((a) => a.name === jobData.agent);
        if (agentDef) {
          systemPrompt = agentDef.body + "\n\n" + buildContextSuffix("chat");
          if (!contextModel) contextModel = agentDef.model;
        }
      }
      const resolvedPrompt = resolveJobPrompt(jobData);
      const source = resolvedPrompt.source === "file" ? ` from ${resolvedPrompt.filePath}` : "";
      systemPrompt += `\n\n## Job Context\nYou are chatting in the context of job "${jobData.name}" (schedule: ${jobData.schedule}).\n\nJob prompt (${resolvedPrompt.source}${source}):\n${resolvedPrompt.prompt}`;
    }
  }

  // Watch mode: inject behavior into system prompt
  if (opts.watchBehavior) {
    const { channel: watchChannel, behavior } = opts.watchBehavior;
    systemPrompt += `\n\n## Watch Mode — #${watchChannel}\n\nYou are monitoring this Slack channel. Follow the behavior instructions below.\nRespond with [NO_REPLY] if no action is needed — do not explain why.\n\n${behavior}`;
  }

  // The backend chain: configured primary first, then provider-down fallbacks.
  // Chat normally runs on the primary; a provider-down turn fails over to the
  // next backend (answering the current message — see send()).
  const backends = resolveBackends();
  let backendIndex = 0;

  let sessionId: string | null = null;
  if (typeof resume === "string") {
    // Specific session ID provided
    sessionId = resume;
  } else if (resume) {
    sessionId = await Session.getLatest(room);
  }

  // Verify the primary backend can actually resume this session before
  // attempting it (Claude probes the on-disk jsonl; others use their own check).
  if (sessionId && !(await backends[0]!.canResume(sessionId, cwd))) {
    sessionId = null;
  }

  let session: AgentSession | null = null;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let longRunningTimer: ReturnType<typeof setTimeout> | null = null;
  let messageCount = 0;
  let inFlight = false;

  function clearIdleTimer() {
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  }

  function resetIdleTimer() {
    clearIdleTimer();
    idleTimer = setTimeout(async () => {
      if (inFlight) {
        // Don't tear down while a request is in flight
        log.warn({ room }, "idle timer fired while request in flight, skipping teardown");
        return;
      }
      // Enqueue finalization before "sleep"
      if (sessionId && messageCount > 0) {
        finalizeSession(sessionId, room).catch((err) => {
          log.error({ err, room }, "finalization enqueue failed during idle teardown");
        });
      }
      await teardown();
    }, IDLE_TIMEOUT);
  }

  function clearLongRunningTimer() {
    if (longRunningTimer) {
      clearTimeout(longRunningTimer);
      longRunningTimer = null;
    }
  }

  function startLongRunningTimer() {
    clearLongRunningTimer();
    longRunningTimer = setTimeout(() => {
      log.warn({ room, elapsed: LONG_RUNNING_WARN / 1000 }, "engine request running for 30+ minutes");
    }, LONG_RUNNING_WARN);
  }

  async function teardown() {
    clearIdleTimer();
    clearLongRunningTimer();
    if (session) {
      await session.close().catch(() => {});
      session = null;
    }
    unregisterActiveHandle(room);
  }

  /** Lazily open (and reuse) the current backend's session for this engine. */
  async function ensureSession(): Promise<AgentSession> {
    if (session) return session;
    const backend = backends[backendIndex] ?? backends[0]!;
    const s = await backend.openSession({
      room,
      channel,
      systemPrompt,
      cwd,
      model: contextModel ?? undefined,
      mcpServers,
      resume: sessionId ?? false,
      subagents: getAgentDefinitions(),
      interactive: true,
    });
    registerActiveHandle(room, (reason) => {
      s.abort(reason);
    });
    session = s;
    return s;
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
      inFlight = true;

      // Cancel any pending finalization — session is active again
      if (sessionId) {
        cancelPending(sessionId).catch(() => {});
      }

      await ActiveEngine.register(room, channel);

      // Save the user message eagerly for an already-known (resumed) session;
      // for a brand-new session we save it once on the `session` event below.
      let userSaved = false;
      if (sessionId) {
        await Message.save({ sessionId, room, sender: "user", content: userMessage, isFromAgent: false });
        await Session.touch(sessionId);
        userSaved = true;
        messageCount++;
      }

      let result: SendResult = { result: "", costUsd: 0, turns: 0 };

      // Run the turn on the current backend; on a provider-down result, fail over
      // to the next backend and answer the current message there.
      while (true) {
        const sess = await ensureSession();
        let accumulated = "";
        let providerDown = false;

        try {
          for await (const ev of sess.send(userMessage, attachments)) {
            switch (ev.type) {
              case "session": {
                if (!sessionId || ev.backendSessionId !== sessionId) {
                  sessionId = ev.backendSessionId;
                  await Session.create(sessionId, room);
                }
                if (!userSaved) {
                  await Message.save({ sessionId, room, sender: "user", content: userMessage, isFromAgent: false });
                  userSaved = true;
                  messageCount++;
                }
                break;
              }
              case "text":
                accumulated += ev.delta;
                callbacks?.onStream?.(accumulated);
                break;
              case "thinking":
                callbacks?.onActivity?.(ev.delta);
                break;
              case "tool":
                callbacks?.onActivity?.(ev.summary ?? ev.name);
                break;
              case "result": {
                const costUsd = ev.usage.costUsd ?? 0;
                const turns = ev.usage.turns ?? 0;
                let messageId: number | undefined;
                if (sessionId && ev.text) {
                  const saveParams = {
                    sessionId,
                    room,
                    sender: "nia",
                    content: ev.text,
                    isFromAgent: true,
                    deliveryStatus: "pending" as const,
                    metadata: ev.metadata,
                  };
                  try {
                    messageId = await Message.save(saveParams);
                  } catch {
                    messageId = await Message.save({ ...saveParams, metadata: undefined });
                  }
                  await Session.touch(sessionId);
                  Session.accumulateMetadata(sessionId, { ...(ev.metadata ?? {}), channel }).catch(() => {});
                }
                result = { result: ev.text, costUsd, turns, messageId };
                break;
              }
              case "error": {
                providerDown = ev.providerDown;
                log.error(
                  { room, error: ev.message, terminal_reason: ev.terminalReason },
                  "chat send failed with backend error",
                );
                result = {
                  result: formatChatError(ev.message),
                  costUsd: 0,
                  turns: 0,
                  signal: ev.providerDown ? "provider_down" : undefined,
                };
                break;
              }
            }
          }
        } catch (err) {
          await ActiveEngine.unregister(room).catch(() => {});
          clearLongRunningTimer();
          inFlight = false;
          if (sess.backendSessionId) sessionId = sess.backendSessionId;
          throw err instanceof Error ? err : new Error(String(err));
        }

        // Re-read the backend session id post-send so finalize/DB target it.
        if (sess.backendSessionId) sessionId = sess.backendSessionId;

        if (providerDown && backendIndex < backends.length - 1) {
          backendIndex++;
          log.warn({ room, to: backends[backendIndex]!.name }, "chat provider down, failing over to next backend");
          await teardown(); // close the dead session so ensureSession opens the next backend
          sessionId = null; // a cross-backend session id is meaningless; start fresh
          continue;
        }
        break;
      }

      await ActiveEngine.unregister(room);
      clearLongRunningTimer();
      inFlight = false;
      resetIdleTimer();
      return result;
    },

    async close() {
      // Enqueue finalization — processed by daemon or inline if we are the daemon
      if (sessionId && messageCount > 0 && !inFlight) {
        try {
          await finalizeSession(sessionId, room);
        } catch (err) {
          log.error({ err, room }, "finalization enqueue failed during close");
        }
      }
      await teardown();
      await ActiveEngine.unregister(room).catch(() => {});
    },
  };
}
