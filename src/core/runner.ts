import { homedir } from "os";
import { existsSync, mkdirSync, readFileSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { JobInput, JobResult } from "../types";
import { appendAudit, readState, writeState } from "../utils/logger";
import type { AuditEntry, JobState } from "../types";
import { getConfig } from "../utils/config";
import { buildSystemPrompt } from "../chat/identity";
import { buildEmployeePrompt } from "../chat/employee-prompt";
import { getEmployee } from "./employees";
import { scanAgents } from "./agents";
import { truncate, formatToolUse } from "../utils/format-activity";
import { getMcpServers } from "../mcp";
import { ActiveEngine } from "../db/models";
import { getPaths } from "../utils/paths";
import { log } from "../utils/log";

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

  const proc = Bun.spawn(args, {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env },
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
): Promise<RunnerOutput> {
  const sessionId = randomUUID();

  // One-shot async iterable: emit a single user message then close
  async function* singleMessage() {
    yield {
      type: "user" as const,
      message: { role: "user" as const, content: jobPrompt },
      parent_tool_use_id: null,
      session_id: "",
    };
  }

  const options: Record<string, unknown> = {
    systemPrompt,
    cwd,
    permissionMode: "bypassPermissions",
    sessionId,
  };

  if (model && model !== "default") {
    options.model = model;
  }

  const mcpServers = getMcpServers();
  if (mcpServers) {
    options.mcpServers = mcpServers;
  }

  const handle = query({
    prompt: singleMessage() as any,
    options: options as any,
  });

  let agentText = "";
  let actualSessionId = sessionId;
  let terminalReason: string | undefined;
  let accumulatedThinking = "";
  let lastThinkingLine = "";

  try {
    for await (const message of handle) {
      if (message.type === "system" && (message as any).subtype === "init") {
        actualSessionId = (message as any).session_id || sessionId;
      }

      // Stream activity events
      if (onActivity) {
        const msg = message as any;

        if (message.type === "stream_event") {
          const event = msg.event;
          if (event?.type === "content_block_start" && event.content_block?.type === "thinking") {
            accumulatedThinking = "";
            lastThinkingLine = "";
            onActivity("thinking...");
          }
          if (event?.type === "content_block_delta") {
            const delta = event.delta;
            if (delta?.type === "thinking_delta" && delta.thinking) {
              accumulatedThinking += delta.thinking;
              const lines = accumulatedThinking.split("\n");
              if (lines.length > 1) {
                const completeLine = lines[lines.length - 2]?.trim();
                if (completeLine && completeLine !== lastThinkingLine) {
                  lastThinkingLine = completeLine;
                  onActivity(truncate(completeLine, 70));
                }
              }
            }
          }
          if (event?.type === "content_block_stop") {
            accumulatedThinking = "";
            lastThinkingLine = "";
          }
        }

        if (message.type === "tool_use_summary") {
          const name = msg.tool_name || "tool";
          onActivity(formatToolUse(name, msg.tool_input));
        }

        if (message.type === "tool_progress") {
          if (msg.tool_name === "Bash" && msg.content) {
            onActivity(`$ ${truncate(msg.content, 60)}`);
          } else if (msg.content) {
            onActivity(truncate(msg.content, 70));
          }
        }

        if (message.type === "system") {
          if (msg.subtype === "task_started" && msg.description) {
            onActivity(truncate(msg.description, 60));
          }
          if (msg.subtype === "task_progress" && msg.last_tool_name) {
            onActivity(msg.summary || msg.last_tool_name);
          }
        }
      }

      if (message.type === "result") {
        if (!(message as any).is_error) {
          agentText = (message as any).result || "";
          terminalReason = (message as any).terminal_reason;
        } else {
          const errors = (message as any).errors;
          terminalReason = (message as any).terminal_reason;
          return {
            agentText: "",
            sessionId: actualSessionId,
            terminalReason,
            error: errors?.join(", ") || "unknown error",
          };
        }
      }
    }
  } finally {
    handle.close();
  }

  return { agentText, sessionId: actualSessionId, terminalReason };
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
    const output = await runJobWithClaude(systemPrompt, opts.prompt, homedir());
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
// Working memory
// ---------------------------------------------------------------------------

/** Build the working memory block for a stateful job. Returns empty string for stateless jobs. */
export function buildWorkingMemory(jobName: string, stateless?: boolean): string {
  if (stateless) return "";

  const jobDir = join(getPaths().jobsDir, jobName);
  mkdirSync(jobDir, { recursive: true });
  const statePath = join(jobDir, "state.md");
  let stateContent = "";
  if (existsSync(statePath)) {
    try {
      stateContent = readFileSync(statePath, "utf8").trim();
    } catch {
      stateContent = "";
    }
  }

  const stateBlock = stateContent ? `\n${stateContent}\n` : "(first run — no prior state)";

  return `

## Working Memory

You have a persistent workspace at \`${jobDir}/\`. This directory is yours — create files, organize data, track history, maintain state however you need.

Your \`state.md\` from last run:
${stateBlock}

Before finishing, update \`state.md\` with: what you did this run, what you noticed, and what to do or focus on next time. Keep it concise — a working notebook, not a log.`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function runJob(job: JobInput, onActivity?: ActivityCallback): Promise<JobResult> {
  const config = getConfig();
  const timestamp = new Date().toISOString();
  const startMs = performance.now();

  // Update state: running
  const state: Record<string, JobState> = { ...readState() };
  state[job.name] = { lastRun: timestamp, status: "running", duration_ms: 0 };
  writeState(state);

  try {
    let cwd = homedir();
    let output: RunnerOutput;

    // Resolve system prompt: employee > agent > default
    let systemPrompt: string;
    let agentModel: string | undefined;
    if (job.employee) {
      const empPrompt = buildEmployeePrompt(job.employee);
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
        systemPrompt = agentDef.body;
        agentModel = agentDef.model;
      } else {
        systemPrompt = buildSystemPrompt("job");
      }
    } else {
      systemPrompt = buildSystemPrompt("job");
    }

    let jobPrompt = job.prompt
      ? `Job: ${job.name} (schedule: ${job.schedule})\n\n${job.prompt}`
      : `Job: ${job.name} (schedule: ${job.schedule})\n\nExecute your scheduled tasks.`;

    // Working memory: give stateful jobs a persistent workspace
    jobPrompt += buildWorkingMemory(job.name, job.stateless);

    // Model priority: job.model > agent.model > config.model
    const resolvedModel = job.model || agentModel || config.model;

    if (config.runner === "codex") {
      const fullPrompt = `${systemPrompt}\n\n---\n\n${jobPrompt}`;
      output = await runJobWithCodex(fullPrompt, cwd, resolvedModel);
    } else {
      output = await runJobWithClaude(systemPrompt, jobPrompt, cwd, onActivity, resolvedModel);
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
  }
}
