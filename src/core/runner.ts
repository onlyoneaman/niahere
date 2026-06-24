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
import { isRetryableApiError, sleep } from "../utils/retry";
import { registerActiveHandle, unregisterActiveHandle } from "./active-handles";
import { getBackend } from "../agent";

export { buildWorkingMemory } from "./job-prompt";

export type ActivityCallback = (line: string) => void;

interface RunnerOutput {
  agentText: string;
  sessionId: string;
  terminalReason?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Codex runner
// ---------------------------------------------------------------------------

function resolveCodexPath(): string {
  const candidates = ["/opt/homebrew/bin/codex", "/usr/local/bin/codex"];
  return candidates.find((p) => existsSync(p)) || "codex";
}

async function runJobWithCodex(fullPrompt: string, cwd: string, model: string): Promise<RunnerOutput> {
  const codexPath = resolveCodexPath();
  const args = [
    codexPath,
    "exec",
    fullPrompt,
    "-C",
    cwd,
    "--json",
    "--skip-git-repo-check",
    "--dangerously-bypass-approvals-and-sandbox",
  ];
  if (model && model !== "default") {
    args.splice(3, 0, "-m", model);
  }

  const CODEX_EXCLUDED = new Set([
    "ANTHROPIC_API_KEY",
    "OPENAI_API_KEY",
    "GEMINI_API_KEY",
    "SLACK_BOT_TOKEN",
    "SLACK_APP_TOKEN",
    "TELEGRAM_BOT_TOKEN",
    "TWILIO_AUTH_TOKEN",
    "DATABASE_URL",
  ]);
  const codexEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !CODEX_EXCLUDED.has(k)));

  const proc = Bun.spawn(args, {
    stdout: "pipe",
    stderr: "pipe",
    env: codexEnv,
  });

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  let agentText = "";
  let sessionId = "";
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      if (event.type === "thread.started" && event.thread_id) {
        sessionId = event.thread_id;
      }
      if (event.type === "item.completed" && event.item?.type === "agent_message") {
        agentText = event.item.text || "";
      }
    } catch {}
  }

  if (exitCode !== 0) {
    return {
      agentText,
      sessionId,
      error: stderr.trim() || `exit code ${exitCode}`,
    };
  }
  return { agentText, sessionId };
}

// ---------------------------------------------------------------------------
// Claude Agent SDK runner
// ---------------------------------------------------------------------------

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

  try {
    for await (const ev of session.send(jobPrompt)) {
      if (ev.type === "thinking") onActivity?.(ev.delta);
      else if (ev.type === "tool") onActivity?.(ev.summary ?? ev.name);
      else if (ev.type === "result") {
        agentText = ev.text;
        terminalReason = ev.terminalReason;
      } else if (ev.type === "error") {
        error = ev.message;
        terminalReason = ev.terminalReason;
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

  return { agentText, sessionId: session.backendSessionId ?? "", terminalReason, error };
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

    const MAX_API_RETRIES = 2;
    const RETRY_DELAYS = [3_000, 8_000]; // 3s, then 8s

    const jobSourceCtx: McpSourceContext = { jobName: job.name, channel: "system" };

    if (config.runner === "codex") {
      const fullPrompt = `${systemPrompt}\n\n---\n\n${jobPrompt}`;
      output = await runJobWithCodex(fullPrompt, cwd, resolvedModel);
    } else {
      output = await runJobWithClaude(systemPrompt, jobPrompt, cwd, onActivity, resolvedModel, jobSourceCtx, room);

      for (let attempt = 0; attempt < MAX_API_RETRIES && output.error && isRetryableApiError(output.error); attempt++) {
        const delay = RETRY_DELAYS[attempt] ?? 8_000;
        log.warn(
          { job: job.name, attempt: attempt + 1, error: output.error, delayMs: delay },
          "retrying after transient API error",
        );
        await sleep(delay);
        output = await runJobWithClaude(systemPrompt, jobPrompt, cwd, onActivity, resolvedModel, jobSourceCtx, room);
      }
    }

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
