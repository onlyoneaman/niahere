import { existsSync, readdirSync, readFileSync } from "fs";
import { basename, join } from "path";
import yaml from "js-yaml";
import { CronExpressionParser } from "cron-parser";
import { getPaths } from "../utils/paths";
import { log } from "../utils/log";

export interface Job {
  name: string;
  schedule: string;
  enabled: boolean;
  prompt: string;
}

export function parseJobs(): Job[] {
  const { jobsDir } = getPaths();
  if (!existsSync(jobsDir)) return [];

  const files = readdirSync(jobsDir).filter((f) => f.endsWith(".yaml")).sort();
  const jobs: Job[] = [];

  for (const file of files) {
    const name = basename(file, ".yaml");
    let raw: Record<string, unknown> | null;

    try {
      raw = yaml.load(readFileSync(join(jobsDir, file), "utf8")) as Record<string, unknown> | null;
    } catch (err) {
      log.warn({ err, file }, "failed to parse job file, skipping");
      continue;
    }

    if (!raw || typeof raw !== "object") {
      log.warn({ file }, "job file is empty or not an object, skipping");
      continue;
    }

    if (!raw.schedule) {
      log.warn({ file }, "job missing 'schedule' field, skipping");
      continue;
    }

    if (!raw.prompt) {
      log.warn({ file }, "job missing 'prompt' field, skipping");
      continue;
    }

    const schedule = String(raw.schedule);
    let valid = true;
    try { CronExpressionParser.parse(schedule); } catch { valid = false; }
    if (!valid) {
      log.warn({ file, schedule }, "invalid cron schedule, skipping");
      continue;
    }

    jobs.push({
      name,
      schedule,
      enabled: raw.enabled !== false,
      prompt: String(raw.prompt).trim(),
    });
  }

  return jobs;
}
