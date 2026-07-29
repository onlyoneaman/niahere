import { homedir } from "os";
import { existsSync } from "fs";
import { randomUUID } from "crypto";
import type { JobInput, JobResult } from "../types";
import { appendAudit, readState, writeState } from "../utils/logger";
import type { AuditEntry, JobState } from "../types";
import { getConfig } from "../utils/config";
import { buildSystemPrompt, buildContextSuffix } from "../chat/identity";
import { buildEmployeePrompt } from "../chat/employee-prompt";
import { getEmployee } from "./employees";
import { scanAgents } from "./agents";
import { buildJobPrompt } from "./job-prompt";
import { getMcpServers, type McpSourceContext } from "../mcp";
import { ActiveEngine } from "../db/models";
import { log } from "../utils/log";
import { errMsg, ignore } from "../utils/errors";
import { registerActiveHandle, unregisterActiveHandle } from "./active-handles";
import { resolveChain, ChainCursor, describeEntry, type ChainEntry, type AgentSession, type AgentSessionContext, type FailoverScope } from "../agent";

export { buildWorkingMemory } from "./job-prompt";

export type ActivityCallback = (line: string) => void;

interface RunnerOutput {
  agentText: string;
  sessionId: string;
  terminalReason?: string;
  error?: string;
  /** How far the chain should skip after this run. Absent → a real failure, stop. */
  failover?: FailoverScope;
}

// ---------------------------------------------------------------------------
// Shared backend run consumer
// ---------------------------------------------------------------------------

/**
 * Drive one backend session to a `RunnerOutput`: map `AgentEvent`s to activity +
 * result/error, and handle abort. Shared by the Claude and Codex job paths so
 * the consume logic lives in exactly one place.
 */
async function consumeBackendRun(
  session: AgentSession,
  prompt: string,
  onActivity?: ActivityCallback,
  activeRoom?: string,
): Promise<RunnerOutput> {
  let abortReason: string | null = null;
  if (activeRoom) {
    registerActiveHandle(activeRoom, (reason) => {
      abortReason = reason;
      session.abort(reason);
    });
  }

  let agentText = "";
  let terminalReason: string | undefined;
  let error: string | undefined;
  let failover: FailoverScope | undefined;

  try {
    for await (const ev of session.send(prompt)) {
      if (ev.type === "thinking") onActivity?.(ev.delta);
      else if (ev.type === "tool") onActivity?.(ev.summary ?? ev.name);
      else if (ev.type === "result") {
        agentText = ev.text;
        terminalReason = ev.terminalReason;
      } else if (ev.type === "error") {
        error = ev.message;
        terminalReason = ev.terminalReason;
        failover = ev.failover;
      }
    }
  } catch (err) {
    if (abortReason) {
      return {
        agentText: "",
        sessionId: session.backendSessionId ?? "",
        terminalReason: "aborted",
        error: abortReason,
      };
    }
    throw err;
  } finally {
    await session.close();
    if (activeRoom) unregisterActiveHandle(activeRoom);
  }

  if (abortReason) {
    return { agentText: "", sessionId: session.backendSessionId ?? "", terminalReason: "aborted", error: abortReason };
  }

  return { agentText, sessionId: session.backendSessionId ?? "", terminalReason, error, failover };
}

/** One attempt. A backend that cannot even start (missing CLI, endpoint down)
 *  must not take the run with it. */
async function runEntry(
  entry: ChainEntry,
  sessionCtx: AgentSessionContext,
  prompt: string,
  onActivity?: ActivityCallback,
  activeRoom?: string,
): Promise<RunnerOutput> {
  try {
    const session = await entry.backend.openSession({ ...sessionCtx, model: entry.model });
    return await consumeBackendRun(session, prompt, onActivity, activeRoom);
  } catch (err) {
    const message = errMsg(err);
    log.warn({ entry: describeEntry(entry), err: message }, "backend failed to start");
    return { agentText: "", sessionId: "", error: message, failover: "provider" };
  }
}

/**
 * Run a job down the chain. The prompt is replayed as-is: continuity comes from
 * Nia's own context, not a cross-backend session resume.
 */
export async function runJobAcrossChain(
  chain: ChainEntry[],
  sessionCtx: AgentSessionContext,
  jobPrompt: string,
  onActivity?: ActivityCallback,
  activeRoom?: string,
): Promise<RunnerOutput> {
  const cursor = new ChainCursor(chain);
  let output: RunnerOutput = { agentText: "", sessionId: "", error: "no model configured" };

  for (let entry = cursor.current; entry; ) {
    output = await runEntry(entry, sessionCtx, jobPrompt, onActivity, activeRoom);
    if (!output.failover) return output;

    const from = describeEntry(entry);
    entry = cursor.advance(output.failover);
    if (entry) log.warn({ from, to: describeEntry(entry), scope: output.failover }, "failing over to next model");
  }
  return output;
}

export interface OneShotOptions {
  systemPrompt: string;
  prompt: string;
  cwd: string;
  onActivity?: ActivityCallback;
  source?: McpSourceContext;
  activeRoom?: string;
}

/** A one-shot run across the chain — no session, no resume. */
export async function runOneShot(opts: OneShotOptions): Promise<RunnerOutput> {
  const sessionCtx: AgentSessionContext = {
    room: opts.activeRoom ?? `_oneshot/${randomUUID()}`,
    channel: "system",
    systemPrompt: opts.systemPrompt,
    cwd: opts.cwd,
    mcpServers: (getMcpServers(opts.source) as Record<string, unknown> | undefined) ?? undefined,
    source: opts.source,
    resume: false,
  };
  return runJobAcrossChain(resolveChain(), sessionCtx, opts.prompt, opts.onActivity, opts.activeRoom);
}

// ---------------------------------------------------------------------------
// Background task runner — tracked one-shot agent with full Nia personality
// ---------------------------------------------------------------------------

export interface TaskOptions {
  /** Task name — used for ActiveEngine tracking as _system/{name}. */
  name: string;
  /** The prompt/instruction for the task. */
  prompt: string;
  /** System prompt override. Defaults to buildSystemPrompt("job"). */
  systemPrompt?: string;
}

/**
 * Run a background agent task with ActiveEngine tracking and MCP tools.
 * Use for consolidator, summarizer, and any future background work.
 */
export async function runTask(opts: TaskOptions): Promise<RunnerOutput> {
  const room = `_system/${opts.name}`;
  await ignore(ActiveEngine.register(room, "system"), "register system active-engine");
  try {
    const systemPrompt = opts.systemPrompt || buildSystemPrompt("job");
    const output = await runOneShot({ systemPrompt, prompt: opts.prompt, cwd: homedir(), activeRoom: room });
    if (output.error) {
      log.error({ task: opts.name, error: output.error }, "task failed");
    } else {
      log.info({ task: opts.name, resultChars: output.agentText.length }, "task completed");
    }
    return output;
  } finally {
    await ignore(ActiveEngine.unregister(room), "unregister active-engine");
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function runJob(job: JobInput, onActivity?: ActivityCallback): Promise<JobResult> {
  const config = getConfig();
  const timestamp = new Date().toISOString();
  const startMs = performance.now();
  const room = `job/${job.name}`;

  // Update state: running
  const state: Record<string, JobState> = { ...readState() };
  state[job.name] = { lastRun: timestamp, status: "running", duration_ms: 0 };
  writeState(state);
  await ignore(ActiveEngine.register(room, "job"), "register job active-engine");

  try {
    let cwd = homedir();
    let output: RunnerOutput;

    // Resolve system prompt: employee > agent > default
    let systemPrompt: string;
    let agentModel: string | undefined;
    if (job.employee) {
      const empPrompt = buildEmployeePrompt(job.employee, "job");
      if (empPrompt) {
        systemPrompt = empPrompt;
      } else {
        systemPrompt = buildSystemPrompt("job");
      }
      const emp = getEmployee(job.employee);
      if (emp?.model) agentModel = emp.model;
      if (emp?.repo && existsSync(emp.repo)) cwd = emp.repo;
    } else if (job.agent) {
      const agents = scanAgents();
      const agentDef = agents.find((a) => a.name === job.agent);
      if (agentDef) {
        systemPrompt = agentDef.body + "\n\n" + buildContextSuffix("job");
        agentModel = agentDef.model;
      } else {
        systemPrompt = buildSystemPrompt("job");
      }
    } else {
      systemPrompt = buildSystemPrompt("job");
    }

    const jobPrompt = buildJobPrompt(job);

    // Model priority: job.model > agent.model > config.model
    const resolvedModel = job.model || agentModel || config.model;

    const jobSourceCtx: McpSourceContext = { jobName: job.name, channel: "system" };

    // One context serves every backend: Claude uses the pre-built in-process
    // mcpServers; Codex/Gemini use `source` to wire the loopback endpoint. Run
    // across the configured backend chain so a provider-down primary fails over.
    const sessionCtx: AgentSessionContext = {
      room,
      channel: "system",
      systemPrompt,
      cwd,
      model: resolvedModel,
      mcpServers: (getMcpServers(jobSourceCtx) as Record<string, unknown> | undefined) ?? undefined,
      source: jobSourceCtx,
      resume: false,
    };
    output = await runJobAcrossChain(resolveChain(), sessionCtx, jobPrompt, onActivity, room);

    const duration_ms = Math.round(performance.now() - startMs);
    const ok = !output.error;

    const result: JobResult = {
      job: job.name,
      timestamp,
      status: ok ? "ok" : "error",
      result: output.agentText.trim(),
      duration_ms,
      session_id: output.sessionId || undefined,
      terminal_reason: output.terminalReason,
      error: output.error,
    };

    const auditEntry: AuditEntry = {
      job: result.job,
      timestamp: result.timestamp,
      status: result.status,
      result: result.result.slice(0, 2000),
      duration_ms: result.duration_ms,
      session_id: result.session_id,
      terminal_reason: result.terminal_reason,
      error: result.error,
    };
    appendAudit(auditEntry);

    // Re-read state to avoid clobbering concurrent job updates
    const freshState = { ...readState() };
    freshState[job.name] = {
      lastRun: timestamp,
      status: result.status,
      duration_ms: result.duration_ms,
      error: result.error,
    };
    writeState(freshState);

    return result;
  } catch (err) {
    const duration_ms = Math.round(performance.now() - startMs);
    const errorMsg = errMsg(err);

    const result: JobResult = {
      job: job.name,
      timestamp,
      status: "error",
      result: "",
      duration_ms,
      error: errorMsg,
    };

    appendAudit({
      job: result.job,
      timestamp: result.timestamp,
      status: "error",
      result: "",
      duration_ms,
      error: errorMsg,
    });

    // Re-read state to avoid clobbering concurrent job updates
    const freshState = { ...readState() };
    freshState[job.name] = {
      lastRun: timestamp,
      status: "error",
      duration_ms,
      error: errorMsg,
    };
    writeState(freshState);

    return result;
  } finally {
    await ignore(ActiveEngine.unregister(room), "unregister active-engine");
  }
}
