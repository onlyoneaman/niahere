import { CronExpressionParser } from "cron-parser";
import { parseDuration } from "./duration";
import type { ScheduleType } from "../types";

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

export function computeInitialNextRun(scheduleType: ScheduleType, schedule: string, timezone: string): Date {
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
