import type { JobStatus } from "./enums";

export interface JobInput {
  name: string;
  schedule: string;
  prompt: string;
  agent?: string | null;
  employee?: string | null;
  model?: string | null;
  stateless?: boolean;
}

export type JobPromptSource = "file" | "database" | "default";

export interface ResolvedJobPrompt {
  prompt: string;
  source: JobPromptSource;
  filePath: string | null;
}

export interface JobResult {
  job: string;
  timestamp: string;
  status: JobStatus;
  result: string;
  duration_ms: number;
  session_id?: string;
  terminal_reason?: string;
  error?: string;
}
