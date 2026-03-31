import { CronExpressionParser } from "cron-parser";
import { parseDuration } from "../utils/duration";
import type { ScheduleType } from "../types";
import { Job } from "../db/models";
import { runJob } from "./runner";
import { getConfig } from "../utils/config";
import { log } from "../utils/log";

export function computeNextRun(
  scheduleType: ScheduleType,
  schedule: string,
  timezone: string,
  lastRunAt?: Date,
): Date | null {
  switch (scheduleType) {
    case "cron": {
      const expr = CronExpressionParser.parse(schedule, { tz: timezone });
      return expr.next().toDate();
    }
    case "interval": {
      const ms = parseDuration(schedule);
      const base = lastRunAt || new Date();
      return new Date(base.getTime() + ms);
    }
    case "once":
      return null;
  }
}

export function computeInitialNextRun(
  scheduleType: ScheduleType,
  schedule: string,
  timezone: string,
): Date {
  switch (scheduleType) {
    case "cron": {
      const expr = CronExpressionParser.parse(schedule, { tz: timezone });
      return expr.next().toDate();
    }
    case "interval": {
      const ms = parseDuration(schedule);
      return new Date(Date.now() + ms);
    }
    case "once":
      return new Date(schedule);
  }
}

function isWithinActiveHours(): boolean {
  const config = getConfig();
  const { start, end } = config.activeHours;
  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: config.timezone,
  });
  const current = formatter.format(now).replace(/\u200e/g, "");
  // Handle midnight-crossing windows (e.g. 09:00–02:00)
  if (start <= end) {
    return current >= start && current <= end;
  }
  return current >= start || current <= end;
}

let timer: ReturnType<typeof setInterval> | null = null;
const runningJobs = new Set<string>();

async function tick(): Promise<void> {
  let dueJobs: Awaited<ReturnType<typeof Job.listDue>>;
  try {
    dueJobs = await Job.listDue();
  } catch (err) {
    log.warn({ err }, "scheduler: failed to query due jobs");
    return;
  }

  const config = getConfig();

  for (const job of dueJobs) {
    if (!job.always && !isWithinActiveHours()) {
      try {
        const nextRun = computeNextRun(job.scheduleType, job.schedule, config.timezone, new Date());
        if (nextRun) await Job.markRun(job.name, nextRun).catch(() => {});
      } catch {}
      log.info({ job: job.name }, "scheduler: skipping — outside active hours");
      continue;
    }

    if (runningJobs.has(job.name)) {
      log.info({ job: job.name }, "scheduler: skipping — still running from previous invocation");
      continue;
    }

    log.info({ job: job.name, type: job.scheduleType }, "scheduler: running job");
    runningJobs.add(job.name);

    runJob(job).then((result) => {
      log.info({ job: job.name, status: result.status, duration: result.duration_ms }, "scheduler: job completed");
    }).catch((err) => {
      log.error({ err, job: job.name }, "scheduler: job failed");
    }).finally(() => {
      runningJobs.delete(job.name);
    });

    let nextRun: Date | null = null;
    try {
      nextRun = computeNextRun(job.scheduleType, job.schedule, config.timezone, new Date());
    } catch (err) {
      log.error({ err, job: job.name, schedule: job.schedule }, "scheduler: invalid schedule, disabling job");
      await Job.update(job.name, { enabled: false }).catch(() => {});
      continue;
    }
    await Job.markRun(job.name, nextRun).catch((err) => {
      log.error({ err, job: job.name }, "scheduler: failed to update next_run_at");
    });

    // Auto-disable one-shot jobs after execution
    if (job.scheduleType === "once") {
      await Job.update(job.name, { enabled: false }).catch(() => {});
      log.info({ job: job.name }, "scheduler: one-shot job completed, auto-disabled");
    }
  }
}

export function startScheduler(): void {
  log.info("scheduler started (60s poll interval)");
  tick();
  timer = setInterval(tick, 60_000);
}

export function stopScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

export async function recomputeAllNextRuns(): Promise<void> {
  const config = getConfig();
  const jobs = await Job.listEnabled();
  const { getSql } = await import("../db/connection");
  const sql = getSql();

  for (const job of jobs) {
    if (job.nextRunAt) continue;
    const nextRun = computeInitialNextRun(job.scheduleType, job.schedule, config.timezone);
    await sql`UPDATE jobs SET next_run_at = ${nextRun} WHERE name = ${job.name}`;
  }
}
