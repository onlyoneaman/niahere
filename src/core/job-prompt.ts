import { existsSync, mkdirSync, readFileSync } from "fs";
import { join } from "path";
import type { JobInput, ResolvedJobPrompt } from "../types";
import { log } from "../utils/log";
import { getJobDir } from "../utils/job-workspace";

const DEFAULT_JOB_PROMPT = "Execute your scheduled tasks.";

export { getJobDir } from "../utils/job-workspace";

export function resolveJobPrompt(job: JobInput): ResolvedJobPrompt {
  let promptPath: string | null = null;
  try {
    promptPath = join(getJobDir(job.name), "prompt.md");
  } catch (err) {
    log.warn({ err, job: job.name }, "job has no safe workspace; falling back to database prompt");
  }

  if (promptPath && existsSync(promptPath)) {
    try {
      const filePrompt = readFileSync(promptPath, "utf8").trim();
      if (filePrompt) {
        return { prompt: filePrompt, source: "file", filePath: promptPath };
      }
      log.warn({ job: job.name, promptPath }, "job prompt.md is empty; falling back to database prompt");
    } catch (err) {
      log.warn({ err, job: job.name, promptPath }, "failed to read job prompt.md; falling back to database prompt");
    }
  }

  const dbPrompt = job.prompt.trim();
  if (dbPrompt) {
    return { prompt: dbPrompt, source: "database", filePath: null };
  }

  return { prompt: DEFAULT_JOB_PROMPT, source: "default", filePath: null };
}

/** Build the working memory block for a stateful job. Returns empty string for stateless jobs. */
export function buildWorkingMemory(jobName: string, stateless?: boolean): string {
  if (stateless) return "";

  let jobDir: string;
  try {
    jobDir = getJobDir(jobName);
  } catch (err) {
    log.warn({ err, job: jobName }, "job has no safe workspace; working memory disabled");
    return "";
  }
  mkdirSync(jobDir, { recursive: true });
  const statePath = join(jobDir, "state.md");
  let stateContent = "";
  if (existsSync(statePath)) {
    try {
      stateContent = readFileSync(statePath, "utf8").trim();
    } catch {
      stateContent = "";
    }
  }

  const stateBlock = stateContent ? `\n${stateContent}\n` : "(first run - no prior state)";

  return `

## Working Memory

You have a persistent workspace at \`${jobDir}/\`. This directory is yours - create files, organize data, track history, maintain state however you need.

Your \`state.md\` from last run:
${stateBlock}

Before finishing, update \`state.md\` with: what you did this run, what you noticed, and what to do or focus on next time. Keep it concise - a working notebook, not a log.`;
}

export function buildJobPrompt(job: JobInput): string {
  const resolved = resolveJobPrompt(job);
  return `Job: ${job.name} (schedule: ${job.schedule})\n\n${resolved.prompt}${buildWorkingMemory(job.name, job.stateless)}`;
}
