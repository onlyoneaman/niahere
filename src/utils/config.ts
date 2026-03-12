import { existsSync, readFileSync } from "fs";
import yaml from "js-yaml";
import { getPaths } from "./paths";
import { log } from "./log";

export interface Config {
  model: string;
  timezone: string;
  activeHours: { start: string; end: string };
  workspace: string;
}

const TIME_RE = /^\d{2}:\d{2}$/;

const DEFAULTS: Omit<Config, "workspace"> = {
  model: "default",
  timezone: process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone,
  activeHours: { start: "00:00", end: "23:59" },
};

export function loadConfig(workspace: string): Config {
  const paths = getPaths(workspace);

  if (!existsSync(paths.config)) {
    return { ...DEFAULTS, workspace };
  }

  let raw: Record<string, unknown> | null;
  try {
    raw = yaml.load(readFileSync(paths.config, "utf8")) as Record<string, unknown> | null;
  } catch (err) {
    log.warn({ err, path: paths.config }, "failed to parse nia.yaml, using defaults");
    return { ...DEFAULTS, workspace };
  }

  if (!raw || typeof raw !== "object") {
    log.warn({ path: paths.config }, "nia.yaml is empty or not an object, using defaults");
    return { ...DEFAULTS, workspace };
  }

  // Validate model
  const model = typeof raw.model === "string" ? raw.model : DEFAULTS.model;

  // Validate timezone
  let timezone = DEFAULTS.timezone;
  if (typeof raw.timezone === "string") {
    try {
      Intl.DateTimeFormat(undefined, { timeZone: raw.timezone });
      timezone = raw.timezone;
    } catch {
      log.warn({ timezone: raw.timezone }, "invalid timezone in nia.yaml, using system default");
    }
  }

  // Validate active hours
  const activeHours = raw.active_hours as Record<string, string> | undefined;
  const start = activeHours?.start || DEFAULTS.activeHours.start;
  const end = activeHours?.end || DEFAULTS.activeHours.end;

  if (!TIME_RE.test(start) || !TIME_RE.test(end)) {
    log.warn({ start, end }, "invalid active_hours format (expected HH:MM), using defaults");
    return { model, timezone, activeHours: DEFAULTS.activeHours, workspace };
  }

  return { model, timezone, activeHours: { start, end }, workspace };
}
