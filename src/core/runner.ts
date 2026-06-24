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
import { registerActiveHandle, unregisterActiveHandle } from "./active-handles";
import { getBackend, resolveBackends, type AgentBackend, type AgentSession, type AgentSessionContext } from "../agent";

export { buildWorkingMemory } from "./job-prompt";

export type ActivityCallback = (line: string) => void;

interface RunnerOutput {
  agentText: string;
  sessionId: string;
  terminalReason?: string;
  error?: string;
  /** The backend reported provider-down — caller may fail over to the next backend. */
  providerDown?: boolean;
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
  let providerDown = false;

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
        providerDown = ev.providerDown;
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

  return { agentText, sessionId: session.backendSessionId ?? "", terminalReason, error, providerDown };
}

/**
 * Run a job across the ordered backend chain: try the primary, and on a
 * provider-down result fail over to the next backend (replaying the same prompt;
 * continuity comes from Nia's own context, not a cross-backend session resume).
 */
export async function runJobAcrossBackends(
  backends: AgentBackend[],
  sessionCtx: AgentSessionContext,
  jobPrompt: string,
  onActivity?: ActivityCallback,
  activeRoom?: string,
): Promise<RunnerOutput> {
  let output: RunnerOutput = { agentText: "", sessionId: "", error: "no backend configured" };
  for (let i = 0; i < backends.length; i++) {
    const backend = backends[i]!;
    const session = await backend.openSession(sessionCtx);
    output = await consumeBackendRun(session, jobPrompt, onActivity, activeRoom);
    if (!output.providerDown) return output;
    const next = backends[i + 1];
    if (next) log.warn({ from: backend.name, to: next.name }, "provider down, failing over to next backend");
  }
  return output;
}

/**
 * Run a one-shot job on the in-process Claude backend. Kept as a named export
 * (signature stable) because `alive.ts` and `runTask` call it directly.
 */
export async function runJobWithClaude(
  systemPrompt: string,
  jobPrompt: string,
  cwd: string,
  onActivity?: ActivityCallback,
  model?: string,
  sourceCtx?: McpSourceContext,
  activeRoom?: string,
): Promise<RunnerOutput> {
  const mcpServers = (getMcpServers(sourceCtx) as Record<string, unknown> | undefined) ?? undefined;
  const session = await getBackend().openSession({
    room: activeRoom ?? `_oneshot/${randomUUID()}`,
    channel: "system",
    systemPrompt,
    cwd,
    model,
    mcpServers,
    source: sourceCtx,
    resume: false,
  });
  return consumeBackendRun(session, jobPrompt, onActivity, activeRoom);
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
  await ActiveEngine.register(room, "system").catch(() => {});
  try {
    const systemPrompt = opts.systemPrompt || buildSystemPrompt("job");
    const output = await runJobWithClaude(systemPrompt, opts.prompt, homedir(), undefined, undefined, undefined, room);
    if (output.error) {
      log.error({ task: opts.name, error: output.error }, "task failed");
    } else {
      log.info({ task: opts.name, resultChars: output.agentText.length }, "task completed");
    }
    return output;
  } finally {
    await ActiveEngine.unregister(room).catch(() => {});
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
  await ActiveEngine.register(room, "job").catch(() => {});

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
    output = await runJobAcrossBackends(resolveBackends(), sessionCtx, jobPrompt, onActivity, room);

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
    const errorMsg = err instanceof Error ? err.message : String(err);

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
    await ActiveEngine.unregister(room).catch(() => {});
  }
}
