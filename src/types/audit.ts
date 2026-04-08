import type { JobStatus, JobStateStatus } from "./enums";

export interface AuditEntry {
  job: string;
  timestamp: string;
  status: JobStatus;
  result: string;
  duration_ms: number;
  session_id?: string;
  terminal_reason?: string;
  error?: string;
}

export interface JobState {
  lastRun: string;
  status: JobStateStatus;
  duration_ms: number;
  error?: string;
}

export type CronState = Record<string, JobState>;
