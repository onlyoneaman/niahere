import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname } from "path";
import { getPaths } from "./paths";

export interface AuditEntry {
  job: string;
  timestamp: string;
  status: "ok" | "error";
  result: string;
  duration_ms: number;
  session_id?: string;
  error?: string;
}

export interface JobState {
  lastRun: string;
  status: "ok" | "error" | "running";
  duration_ms: number;
  error?: string;
}

export type CronState = Record<string, JobState>;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasString(value: unknown): value is string {
  return typeof value === "string";
}

function hasNumber(value: unknown): value is number {
  return typeof value === "number";
}

function isJobState(value: unknown): value is JobState {
  return (
    isObject(value) &&
    hasString(value.lastRun) &&
    (value.status === "ok" || value.status === "error" || value.status === "running") &&
    hasNumber(value.duration_ms)
  );
}

function isCronState(value: unknown): value is CronState {
  if (!isObject(value)) return false;
  for (const [k, v] of Object.entries(value)) {
    if (!hasString(k) || !isJobState(v)) return false;
  }
  return true;
}

export function appendAudit(entry: AuditEntry): void {
  const { cronAudit } = getPaths();
  mkdirSync(dirname(cronAudit), { recursive: true });
  appendFileSync(cronAudit, JSON.stringify(entry) + "\n");
}

export function readState(): CronState {
  const { cronState } = getPaths();
  if (!existsSync(cronState)) return {};

  try {
    const parsed = JSON.parse(readFileSync(cronState, "utf8"));
    return isCronState(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function writeState(state: CronState): void {
  const { cronState } = getPaths();
  mkdirSync(dirname(cronState), { recursive: true });
  writeFileSync(cronState, JSON.stringify(state, null, 2));
}

export function readAudit(jobName?: string, limit = 10): AuditEntry[] {
  const { cronAudit } = getPaths();
  if (!existsSync(cronAudit)) return [];

  const lines = readFileSync(cronAudit, "utf8").trim().split("\n").filter(Boolean);
  let entries: AuditEntry[] = [];
  for (const line of lines) {
    try {
      entries.push(JSON.parse(line));
    } catch {
      // skip malformed
    }
  }

  if (jobName) {
    entries = entries.filter((e) => e.job === jobName);
  }

  return entries.slice(-limit);
}
