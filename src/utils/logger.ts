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
