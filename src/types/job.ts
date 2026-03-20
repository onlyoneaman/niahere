import type { JobStatus } from "./enums";

export interface JobInput {
  name: string;
  schedule: string;
  prompt: string;
  agent?: string | null;
}

export interface JobResult {
  job: string;
  timestamp: string;
  status: JobStatus;
  result: string;
  duration_ms: number;
  session_id?: string;
  error?: string;
}
