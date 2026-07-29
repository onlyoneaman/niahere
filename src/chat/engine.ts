import { existsSync } from "fs";
import { homedir } from "os";
import { buildSystemPrompt, buildContextSuffix, getSessionContext } from "./identity";
import { buildEmployeePrompt } from "./employee-prompt";
import { getEmployee } from "../core/employees";
import { getAgentDefinitions, scanAgents } from "../core/agents";
import { gapMarker } from "./gap-marker";
import { getConfig } from "../utils/config";
import { Session, Message, ActiveEngine, Job } from "../db/models";
import type { Attachment, SendResult, SendCallbacks, ChatEngine, EngineOptions } from "../types";
import { finalizeSession, cancelPending } from "../core/finalizer";
import { log } from "../utils/log";
import { asError, errMsg, ignore } from "../utils/errors";
import { registerActiveHandle, unregisterActiveHandle } from "../core/active-handles";
import { resolveJobPrompt } from "../core/job-prompt";
import { truncate } from "../utils/format-activity";
import { resolveChain, ChainCursor, describeEntry, type AgentSession, type FailoverScope } from "../agent";
import { scopeOf, parseFailure } from "../agent/failure";

const IDLE_TIMEOUT = 10 * 60 * 1000; // 10 minutes
const HANDOFF_MESSAGES = 20;
const HANDOFF_CHARS = 2000;
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
  return scopeOf(parseFailure(rawError), "provider") === "provider" ? "provider_down" : undefined;
}

export async function createChatEngine(opts: EngineOptions): Promise<ChatEngine> {
  const { room, channel, resume, mcpServers } = opts;
  let systemPrompt = buildSystemPrompt("chat", channel);

  // Recent session summaries for continuity. Appended AFTER persona selection
  // below — the employee/agent branches replace systemPrompt wholesale, so
  // injecting here would be discarded for those contexts.
  const sessionContext = await getSessionContext(room);

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

  // Continuity summaries — appended after persona so employee/agent contexts keep them.
  if (sessionContext) {
    systemPrompt += "\n\n" + sessionContext;
  }

  // Watch mode: inject behavior into system prompt
  if (opts.watchBehavior) {
    const { channel: watchChannel, behavior } = opts.watchBehavior;
    systemPrompt += `\n\n## Watch Mode — #${watchChannel}\n\nYou are monitoring this Slack channel. Follow the behavior instructions below.\nRespond with [NO_REPLY] if no action is needed — do not explain why.\n\n${behavior}`;
  }

  // A turn that cannot be served moves down the chain and answers the current
  // message there (see send()).
  const chain = resolveChain();
  let cursor = new ChainCursor(chain);

  let sessionId: string | null = null;
  if (typeof resume === "string") {
    // Specific session ID provided
    sessionId = resume;
  } else if (resume) {
    sessionId = await Session.getLatest(room);
  }

  // Only resume if the head of the chain can actually take this session id.
  if (sessionId && !(await cursor.current!.backend.canResume(sessionId, cwd))) {
    sessionId = null;
  }

  let session: AgentSession | null = null;
  // Prior turns, replayed into the system prompt when a failover starts a fresh
  // session on another backend — the new one has no session to resume.
  let handoff = "";
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
      await ignore(session.close(), "close chat session");
      session = null;
    }
    unregisterActiveHandle(room);
  }

  /** Transcript of the conversation so far, for a backend that cannot resume it. */
  async function buildHandoff(currentMessage: string): Promise<string> {
    const recent = await Message.getRecent(HANDOFF_MESSAGES, room).catch(() => []);
    const lines = recent
      .filter((m) => m.content !== currentMessage)
      .map((m) => `${m.sender === "nia" ? "Nia" : "User"}: ${truncate(m.content, HANDOFF_CHARS)}`);
    if (lines.length === 0) return "";
    return `\n\n## Conversation So Far\nYou are continuing this conversation after switching models mid-turn.\n\n${lines.join("\n")}`;
  }

  /** Lazily open (and reuse) the current chain entry's session for this engine. */
  async function ensureSession(): Promise<AgentSession> {
    if (session) return session;
    const entry = cursor.current!;
    const s = await entry.backend.openSession({
      room,
      channel,
      systemPrompt: systemPrompt + handoff,
      cwd,
      // A context override names a model for the configured provider, so it
      // only applies at the head of the chain.
      model: (cursor.atHead ? (contextModel ?? entry.model) : entry.model) ?? undefined,
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

    async send(rawMessage: string, callbacks?: SendCallbacks, attachments?: Attachment[]) {
      // Date the turn when time has visibly passed. Computed before anything is
      // saved, and used for BOTH the send and the save so the stored record is
      // exactly what the model received.
      const marker = gapMarker(new Date(), await Message.getLastAt(room).catch(() => null), getConfig().timezone);
      const userMessage = marker ? `${marker}\n${rawMessage}` : rawMessage;

      // Re-probe from the top once the failed provider's cooldown lapses, so a
      // brief outage does not pin the conversation to the fallback for good.
      if (!cursor.atHead) {
        const fresh = new ChainCursor(chain);
        if (fresh.current !== cursor.current) {
          log.info({ room, to: fresh.current && describeEntry(fresh.current) }, "chat returning to preferred model");
          cursor = fresh;
          handoff = await buildHandoff("");
          await teardown();
          sessionId = null;
        }
      }

      // Clear idle timer — engine is not idle while processing a request
      clearIdleTimer();
      startLongRunningTimer();
      inFlight = true;

      // Cancel any pending finalization — session is active again
      if (sessionId) {
        void ignore(cancelPending(sessionId), "cancel pending finalization");
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

      // Run the turn on the current chain entry; a turn that cannot be served
      // moves down the chain and answers the current message there.
      while (true) {
        let sess: AgentSession;
        try {
          sess = await ensureSession();
        } catch (err) {
          // A backend that cannot start must not take the turn down.
          const next = cursor.advance("provider");
          log.warn({ room, err: String(err), to: next && describeEntry(next) }, "chat backend failed to start");
          if (!next) throw asError(err);
          handoff = await buildHandoff(userMessage);
          continue;
        }
        let accumulated = "";
        let failover: FailoverScope | undefined;

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
                  void ignore(Session.accumulateMetadata(sessionId, { ...(ev.metadata ?? {}), channel }), "accumulate session metadata");
                }
                result = { result: ev.text, costUsd, turns, messageId };
                break;
              }
              case "error": {
                failover = ev.failover;
                log.error(
                  { room, error: ev.message, terminal_reason: ev.terminalReason },
                  "chat send failed with backend error",
                );
                result = {
                  result: formatChatError(ev.message),
                  costUsd: 0,
                  turns: 0,
                  signal: ev.failover === "provider" ? "provider_down" : undefined,
                };
                break;
              }
            }
          }
        } catch (err) {
          await ignore(ActiveEngine.unregister(room), "unregister active-engine");
          clearLongRunningTimer();
          inFlight = false;
          if (sess.backendSessionId) sessionId = sess.backendSessionId;
          throw asError(err);
        }

        // Re-read the backend session id post-send so finalize/DB target it.
        if (sess.backendSessionId) sessionId = sess.backendSessionId;

        const next = failover && cursor.advance(failover);
        if (next) {
          log.warn({ room, to: describeEntry(next), scope: failover }, "chat failing over to next model");
          await teardown(); // close the dead session so ensureSession opens the next entry
          sessionId = null; // a cross-backend session id is meaningless; start fresh
          userSaved = false; // re-save the user turn under the new session
          handoff = await buildHandoff(userMessage);
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
      await ignore(ActiveEngine.unregister(room), "unregister active-engine");
    },
  };
}
