import { homedir } from "os";
export interface JobInput {
  name: string;
  schedule: string;
  prompt: string;
}
import { appendAudit, readState, writeState, type AuditEntry, type JobState } from "../utils/logger";
import { getConfig } from "../utils/config";
import { buildSystemPrompt } from "../chat/identity";

export interface JobResult {
  job: string;
  timestamp: string;
  status: "ok" | "error";
  result: string;
  duration_ms: number;
  error?: string;
}

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
  const state = readState();
  state[job.name] = { lastRun: timestamp, status: "running", duration_ms: 0 };
  writeState(state);

  try {
    const fullPrompt = buildPrompt(job);
    const cwd = homedir();
    const args = ["codex", "exec", fullPrompt, "-C", cwd, "--ephemeral"];
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

    const ok = exitCode === 0;
    const result: JobResult = {
      job: job.name,
      timestamp,
      status: ok ? "ok" : "error",
      result: stdout.trim(),
      duration_ms,
      error: ok ? undefined : stderr.trim() || `exit code ${exitCode}`,
    };

    const auditEntry: AuditEntry = {
      job: result.job,
      timestamp: result.timestamp,
      status: result.status,
      result: result.result.slice(0, 2000),
      duration_ms: result.duration_ms,
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
