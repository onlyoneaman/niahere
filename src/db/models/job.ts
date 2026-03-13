import { getSql } from "../connection";

export interface Job {
  name: string;
  schedule: string;
  prompt: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

function toJob(r: Record<string, any>): Job {
  return {
    name: r.name,
    schedule: r.schedule,
    prompt: r.prompt,
    enabled: r.enabled,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

async function notifyChange(): Promise<void> {
  const sql = getSql();
  await sql`SELECT pg_notify('nia_jobs', '')`;
}

export async function create(name: string, schedule: string, prompt: string): Promise<void> {
  const sql = getSql();
  await sql`
    INSERT INTO jobs (name, schedule, prompt)
    VALUES (${name}, ${schedule}, ${prompt})
  `;
  await notifyChange();
}

export async function list(): Promise<Job[]> {
  const sql = getSql();
  const rows = await sql`SELECT name, schedule, prompt, enabled, created_at, updated_at FROM jobs ORDER BY name`;
  return rows.map(toJob);
}

export async function get(name: string): Promise<Job | null> {
  const sql = getSql();
  const rows = await sql`SELECT name, schedule, prompt, enabled, created_at, updated_at FROM jobs WHERE name = ${name}`;
  return rows.length > 0 ? toJob(rows[0]) : null;
}

export async function update(
  name: string,
  fields: Partial<{ schedule: string; prompt: string; enabled: boolean }>,
): Promise<boolean> {
  const sql = getSql();
  const existing = await get(name);
  if (!existing) return false;

  const schedule = fields.schedule ?? existing.schedule;
  const prompt = fields.prompt ?? existing.prompt;
  const enabled = fields.enabled ?? existing.enabled;

  await sql`
    UPDATE jobs
    SET schedule = ${schedule}, prompt = ${prompt}, enabled = ${enabled}, updated_at = NOW()
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
  const rows = await sql`SELECT name, schedule, prompt, enabled, created_at, updated_at FROM jobs WHERE enabled = TRUE ORDER BY name`;
  return rows.map(toJob);
}
