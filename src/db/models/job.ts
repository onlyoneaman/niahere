import { getSql } from "../connection";
import type { ScheduleType } from "../../types";

export interface Job {
  name: string;
  schedule: string;
  prompt: string;
  enabled: boolean;
  always: boolean;
  scheduleType: ScheduleType;
  agent: string | null;
  nextRunAt: string | null;
  lastRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

function toJob(r: Record<string, any>): Job {
  return {
    name: r.name,
    schedule: r.schedule,
    prompt: r.prompt,
    enabled: r.enabled,
    always: r.always ?? false,
    scheduleType: r.schedule_type || "cron",
    agent: r.agent || null,
    nextRunAt: r.next_run_at ? String(r.next_run_at) : null,
    lastRunAt: r.last_run_at ? String(r.last_run_at) : null,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

async function notifyChange(): Promise<void> {
  const sql = getSql();
  await sql`SELECT pg_notify('nia_jobs', '')`;
}

export async function create(
  name: string,
  schedule: string,
  prompt: string,
  always = false,
  scheduleType: ScheduleType = "cron",
  nextRunAt?: Date,
  agent?: string,
): Promise<void> {
  const existing = await get(name);
  if (existing) {
    throw new Error(`Job "${name}" already exists. Use \`nia job remove ${name}\` first, or choose a different name.`);
  }
  const sql = getSql();
  await sql`
    INSERT INTO jobs (name, schedule, prompt, always, schedule_type, next_run_at, agent)
    VALUES (${name}, ${schedule}, ${prompt}, ${always}, ${scheduleType}, ${nextRunAt ?? null}, ${agent ?? null})
  `;
  await notifyChange();
}

export async function list(): Promise<Job[]> {
  const sql = getSql();
  const rows = await sql`SELECT name, schedule, prompt, enabled, always, schedule_type, agent, next_run_at, last_run_at, created_at, updated_at FROM jobs ORDER BY name`;
  return rows.map(toJob);
}

export async function get(name: string): Promise<Job | null> {
  const sql = getSql();
  const rows = await sql`SELECT name, schedule, prompt, enabled, always, schedule_type, agent, next_run_at, last_run_at, created_at, updated_at FROM jobs WHERE name = ${name}`;
  return rows.length > 0 ? toJob(rows[0]) : null;
}

export async function update(
  name: string,
  fields: Partial<{ schedule: string; prompt: string; enabled: boolean; always: boolean; agent: string | null }>,
): Promise<boolean> {
  const sql = getSql();
  const existing = await get(name);
  if (!existing) return false;

  const schedule = fields.schedule ?? existing.schedule;
  const prompt = fields.prompt ?? existing.prompt;
  const enabled = fields.enabled ?? existing.enabled;
  const always = fields.always ?? existing.always;
  const agent = fields.agent !== undefined ? fields.agent : existing.agent;

  await sql`
    UPDATE jobs
    SET schedule = ${schedule}, prompt = ${prompt}, enabled = ${enabled}, always = ${always}, agent = ${agent}, updated_at = NOW()
    WHERE name = ${name}
  `;
  await notifyChange();
  return true;
}

export async function remove(name: string): Promise<boolean> {
  const sql = getSql();
  const result = await sql`DELETE FROM jobs WHERE name = ${name}`;
  if (result.count > 0) await notifyChange();
  return result.count > 0;
}

export async function listEnabled(): Promise<Job[]> {
  const sql = getSql();
  const rows = await sql`SELECT name, schedule, prompt, enabled, always, schedule_type, agent, next_run_at, last_run_at, created_at, updated_at FROM jobs WHERE enabled = TRUE ORDER BY name`;
  return rows.map(toJob);
}

export async function listDue(): Promise<Job[]> {
  const sql = getSql();
  const rows = await sql`
    SELECT name, schedule, prompt, enabled, always, schedule_type, agent, next_run_at, last_run_at, created_at, updated_at
    FROM jobs
    WHERE enabled = TRUE AND next_run_at <= NOW()
    ORDER BY next_run_at
  `;
  return rows.map(toJob);
}

export async function markRun(name: string, nextRunAt: Date | null): Promise<void> {
  const sql = getSql();
  if (nextRunAt) {
    await sql`UPDATE jobs SET last_run_at = NOW(), next_run_at = ${nextRunAt}, updated_at = NOW() WHERE name = ${name}`;
  } else {
    await sql`UPDATE jobs SET last_run_at = NOW(), enabled = FALSE, updated_at = NOW() WHERE name = ${name}`;
  }
  await notifyChange();
}
