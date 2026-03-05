import type { Job } from "./cron";
import { appendAudit, readState, writeState, type AuditEntry, type JobState } from "./logger";

export interface JobResult {
  job: string;
  timestamp: string;
  status: "ok" | "error";
  result: string;
  duration_ms: number;
  error?: string;
}

export async function runJob(workspace: string, job: Job, model: string): Promise<JobResult> {
  const timestamp = new Date().toISOString();
  const startMs = performance.now();

  // Update state: running
  const state = readState(workspace);
  state[job.name] = { lastRun: timestamp, status: "running", duration_ms: 0 };
  writeState(workspace, state);

  try {
    const args = ["codex", "exec", job.prompt, "--skip-git-repo-check", "--ephemeral"];
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

    // Log audit
    const auditEntry: AuditEntry = {
      job: result.job,
      timestamp: result.timestamp,
      status: result.status,
      result: result.result.slice(0, 2000),
      duration_ms: result.duration_ms,
      error: result.error,
    };
    appendAudit(workspace, auditEntry);

    // Update state
    state[job.name] = {
      lastRun: timestamp,
      status: result.status,
      duration_ms: result.duration_ms,
      error: result.error,
    };
    writeState(workspace, state);

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

    appendAudit(workspace, {
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
    writeState(workspace, state);

    return result;
  }
}
