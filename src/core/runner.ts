import { homedir } from "os";
import { existsSync } from "fs";
import { randomUUID } from "crypto";
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { JobInput, JobResult } from "../types";
import { appendAudit, readState, writeState } from "../utils/logger";
import type { AuditEntry, JobState } from "../types";
import { getConfig } from "../utils/config";
import { buildSystemPrompt } from "../chat/identity";

interface RunnerOutput {
  agentText: string;
  sessionId: string;
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
  const args = [codexPath, "exec", fullPrompt, "-C", cwd, "--json", "--skip-git-repo-check", "--dangerously-bypass-approvals-and-sandbox"];
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
    return { agentText, sessionId, error: stderr.trim() || `exit code ${exitCode}` };
  }
  return { agentText, sessionId };
}

// ---------------------------------------------------------------------------
// Claude Agent SDK runner
// ---------------------------------------------------------------------------

async function runJobWithClaude(systemPrompt: string, jobPrompt: string, cwd: string): Promise<RunnerOutput> {
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

  const handle = query({
    prompt: singleMessage() as any,
    options: {
      systemPrompt,
      cwd,
      permissionMode: "bypassPermissions",
      sessionId,
    } as any,
  });

  let agentText = "";
  let actualSessionId = sessionId;

  try {
    for await (const message of handle) {
      if (message.type === "system" && (message as any).subtype === "init") {
        actualSessionId = (message as any).session_id || sessionId;
      }
      if (message.type === "result") {
        if (!(message as any).is_error) {
          agentText = (message as any).result || "";
        } else {
          const errors = (message as any).errors;
          return { agentText: "", sessionId: actualSessionId, error: errors?.join(", ") || "unknown error" };
        }
      }
    }
  } finally {
    handle.close();
  }

  return { agentText, sessionId: actualSessionId };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function runJob(job: JobInput): Promise<JobResult> {
  const config = getConfig();
  const timestamp = new Date().toISOString();
  const startMs = performance.now();

  // Update state: running
  const state: Record<string, JobState> = { ...readState() };
  state[job.name] = { lastRun: timestamp, status: "running", duration_ms: 0 };
  writeState(state);

  try {
    const cwd = homedir();
    let output: RunnerOutput;

    if (config.runner === "codex") {
      const fullPrompt = `${buildSystemPrompt("job")}\n\n---\n\nJob: ${job.name} (schedule: ${job.schedule})\n\n${job.prompt}`;
      output = await runJobWithCodex(fullPrompt, cwd, config.model);
    } else {
      const systemPrompt = buildSystemPrompt("job");
      const jobPrompt = `Job: ${job.name} (schedule: ${job.schedule})\n\n${job.prompt}`;
      output = await runJobWithClaude(systemPrompt, jobPrompt, cwd);
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
      error: output.error,
    };

    const auditEntry: AuditEntry = {
      job: result.job,
      timestamp: result.timestamp,
      status: result.status,
      result: result.result.slice(0, 2000),
      duration_ms: result.duration_ms,
      session_id: result.session_id,
      error: result.error,
    };
    appendAudit(auditEntry);

    state[job.name] = {
      lastRun: timestamp,
      status: result.status,
      duration_ms: result.duration_ms,
      error: result.error,
    };
    writeState(state);

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

    state[job.name] = {
      lastRun: timestamp,
      status: "error",
      duration_ms,
      error: errorMsg,
    };
    writeState(state);

    return result;
  }
}
