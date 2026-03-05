import { existsSync, readFileSync } from "fs";
import { join } from "path";
import type { Job } from "./cron";
import { appendAudit, readState, writeState, type AuditEntry, type JobState } from "../utils/logger";
import { getPaths } from "../utils/paths";
import { localTime } from "../utils/time";

export interface JobResult {
  job: string;
  timestamp: string;
  status: "ok" | "error";
  result: string;
  duration_ms: number;
  error?: string;
}

function loadIdentity(workspace: string): string {
  const { selfDir } = getPaths(workspace);
  const parts: string[] = [];

  const identityPath = join(selfDir, "identity.md");
  if (existsSync(identityPath)) {
    parts.push(readFileSync(identityPath, "utf8").trim());
  }

  const soulPath = join(selfDir, "soul.md");
  if (existsSync(soulPath)) {
    parts.push(readFileSync(soulPath, "utf8").trim());
  }

  return parts.join("\n\n");
}

function buildPrompt(workspace: string, job: Job): string {
  const identity = loadIdentity(workspace);
  const parts: string[] = [];

  if (identity) {
    parts.push(identity);
  }

  parts.push(`Current time: ${localTime()}`);
  parts.push(`Job: ${job.name} (schedule: ${job.schedule})`);
  parts.push(`---`);
  parts.push(job.prompt);

  return parts.join("\n\n");
}

export async function runJob(workspace: string, job: Job, model: string): Promise<JobResult> {
  const timestamp = new Date().toISOString();
  const startMs = performance.now();

  // Update state: running
  const state = readState(workspace);
  state[job.name] = { lastRun: timestamp, status: "running", duration_ms: 0 };
  writeState(workspace, state);

  try {
    const fullPrompt = buildPrompt(workspace, job);
    const args = ["codex", "exec", fullPrompt, "-C", workspace, "--ephemeral"];
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
