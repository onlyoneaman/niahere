import { homedir } from "os";
import { existsSync } from "fs";
import type { JobInput, JobResult } from "../types";
import { appendAudit, readState, writeState } from "../utils/logger";
import type { AuditEntry, JobState } from "../types";
import { getConfig } from "../utils/config";
import { buildSystemPrompt } from "../chat/identity";

// Resolve full path to codex so daemon doesn't depend on PATH
const CODEX_CANDIDATES = ["/opt/homebrew/bin/codex", "/usr/local/bin/codex"];
const codexPath = CODEX_CANDIDATES.find((p) => existsSync(p)) || "codex";


function buildPrompt(job: JobInput): string {
  const systemPrompt = buildSystemPrompt("job");
  return `${systemPrompt}\n\n---\n\nJob: ${job.name} (schedule: ${job.schedule})\n\n${job.prompt}`;
}

export async function runJob(job: JobInput): Promise<JobResult> {
  const config = getConfig();
  const model = config.model;
  const timestamp = new Date().toISOString();
  const startMs = performance.now();

  // Update state: running
  const state: Record<string, JobState> = { ...readState() };
  state[job.name] = { lastRun: timestamp, status: "running", duration_ms: 0 };
  writeState(state);

  try {
    const fullPrompt = buildPrompt(job);
    const cwd = homedir();
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
    const duration_ms = Math.round(performance.now() - startMs);

    // Parse JSONL events for session ID and final agent message
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

    const ok = exitCode === 0;
    const result: JobResult = {
      job: job.name,
      timestamp,
      status: ok ? "ok" : "error",
      result: agentText.trim(),
      duration_ms,
      session_id: sessionId || undefined,
      error: ok ? undefined : stderr.trim() || `exit code ${exitCode}`,
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
