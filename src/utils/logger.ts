import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname } from "path";
import { getPaths } from "./paths";

export interface AuditEntry {
  job: string;
  timestamp: string;
  status: "ok" | "error";
  result: string;
  duration_ms: number;
  error?: string;
}

export interface JobState {
  lastRun: string;
  status: "ok" | "error" | "running";
  duration_ms: number;
  error?: string;
}

export type CronState = Record<string, JobState>;

export function appendAudit(entry: AuditEntry): void {
  const { cronAudit } = getPaths();
  mkdirSync(dirname(cronAudit), { recursive: true });
  appendFileSync(cronAudit, JSON.stringify(entry) + "\n");
}

export function readState(): CronState {
  const { cronState } = getPaths();
  if (!existsSync(cronState)) return {};

  try {
    return JSON.parse(readFileSync(cronState, "utf8"));
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
