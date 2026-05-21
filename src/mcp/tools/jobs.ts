import { Job } from "../../db/models";
import { computeInitialNextRun } from "../../core/scheduler";
import { getConfig } from "../../utils/config";
import { resolveJobPrompt } from "../../core/job-prompt";
import type { ScheduleType } from "../../types";

export async function listJobs(): Promise<string> {
  const jobs = await Job.list();
  if (jobs.length === 0) return "No jobs found.";
  const withPromptSource = jobs.map((job) => {
    const resolvedPrompt = resolveJobPrompt(job);
    return {
      ...job,
      prompt: resolvedPrompt.prompt,
      promptSource: resolvedPrompt.source,
      promptPath: resolvedPrompt.filePath,
    };
  });
  return JSON.stringify(withPromptSource, null, 2);
}

export async function addJob(args: {
  name: string;
  schedule: string;
  prompt: string;
  schedule_type?: ScheduleType;
  always?: boolean;
  agent?: string;
  employee?: string;
  model?: string;
  stateless?: boolean;
}): Promise<string> {
  const scheduleType = args.schedule_type || "cron";
  const always = args.always || false;
  const stateless = args.stateless || false;
  const config = getConfig();

  const nextRunAt = computeInitialNextRun(scheduleType, args.schedule, config.timezone);
  await Job.create(
    args.name,
    args.schedule,
    args.prompt,
    always,
    scheduleType,
    nextRunAt,
    args.agent,
    stateless,
    args.model,
    args.employee,
  );
  const agentNote = args.agent ? ` [agent: ${args.agent}]` : "";
  const employeeNote = args.employee ? ` [employee: ${args.employee}]` : "";
  const modelNote = args.model ? ` [model: ${args.model}]` : "";
  return `Job "${args.name}" created (${scheduleType}: ${args.schedule})${agentNote}${employeeNote}${modelNote}. Next run: ${nextRunAt.toISOString()}`;
}

export async function updateJob(args: {
  name: string;
  schedule?: string;
  prompt?: string;
  always?: boolean;
  agent?: string | null;
  employee?: string | null;
  model?: string | null;
  stateless?: boolean;
  schedule_type?: "cron" | "interval" | "once";
}): Promise<string> {
  const fields: Partial<{
    schedule: string;
    prompt: string;
    always: boolean;
    stateless: boolean;
    model: string | null;
    agent: string | null;
    employee: string | null;
    scheduleType: "cron" | "interval" | "once";
  }> = {};
  if (args.schedule) fields.schedule = args.schedule;
  if (args.prompt) fields.prompt = args.prompt;
  if (args.always !== undefined) fields.always = args.always;
  if (args.stateless !== undefined) fields.stateless = args.stateless;
  if (args.model !== undefined) fields.model = args.model;
  if (args.agent !== undefined) fields.agent = args.agent;
  if (args.employee !== undefined) fields.employee = args.employee;
  if (args.schedule_type) fields.scheduleType = args.schedule_type;

  if (Object.keys(fields).length === 0)
    return "Nothing to update. Pass at least one field (schedule, prompt, always, stateless, model, agent, employee, or schedule_type).";

  const updated = await Job.update(args.name, fields);
  if (!updated) return `Job "${args.name}" not found.`;
  if (fields.prompt !== undefined) {
    const job = await Job.get(args.name);
    if (job) {
      const resolvedPrompt = resolveJobPrompt(job);
      if (resolvedPrompt.source === "file") {
        return `Job "${args.name}" updated. Note: runtime prompt is still overridden by ${resolvedPrompt.filePath}.`;
      }
    }
  }
  return `Job "${args.name}" updated.`;
}

export async function removeJob(name: string): Promise<string> {
  const removed = await Job.remove(name);
  return removed ? `Job "${name}" removed.` : `Job "${name}" not found.`;
}

export async function enableJob(name: string): Promise<string> {
  const updated = await Job.update(name, { status: "active" });
  if (!updated) return `Job "${name}" not found.`;

  const job = await Job.get(name);
  if (job) {
    const config = getConfig();
    const nextRun = computeInitialNextRun(job.scheduleType, job.schedule, config.timezone);
    const { getSql } = await import("../../db/connection");
    await getSql()`UPDATE jobs SET next_run_at = ${nextRun} WHERE name = ${name}`;
  }
  return `Job "${name}" enabled.`;
}

export async function disableJob(name: string): Promise<string> {
  const updated = await Job.update(name, { status: "disabled" });
  return updated ? `Job "${name}" disabled.` : `Job "${name}" not found.`;
}

export async function archiveJob(name: string): Promise<string> {
  const updated = await Job.update(name, { status: "archived" });
  return updated ? `Job "${name}" archived.` : `Job "${name}" not found.`;
}

export async function unarchiveJob(name: string): Promise<string> {
  const updated = await Job.update(name, { status: "disabled" });
  return updated ? `Job "${name}" unarchived (disabled). Enable with enable_job.` : `Job "${name}" not found.`;
}

export async function runJobNow(name: string): Promise<string> {
  const job = await Job.get(name);
  if (!job) return `Job "${name}" not found.`;

  const { getSql } = await import("../../db/connection");
  await getSql()`UPDATE jobs SET next_run_at = NOW() WHERE name = ${name}`;
  return `Job "${name}" queued for immediate execution.`;
}
