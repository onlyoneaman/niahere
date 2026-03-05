import { existsSync, readFileSync } from "fs";
import yaml from "js-yaml";
import { getPaths } from "./paths";

export interface Config {
  model: string;
  activeHours: { start: string; end: string };
  workspace: string;
}

const DEFAULTS: Omit<Config, "workspace"> = {
  model: "codex-mini-latest",
  activeHours: { start: "00:00", end: "23:59" },
};

export function loadConfig(workspace: string): Config {
  const paths = getPaths(workspace);

  if (!existsSync(paths.config)) {
    return { ...DEFAULTS, workspace };
  }

  const raw = yaml.load(readFileSync(paths.config, "utf8")) as Record<string, unknown> | null;
  if (!raw || typeof raw !== "object") {
    return { ...DEFAULTS, workspace };
  }

  const activeHours = raw.active_hours as Record<string, string> | undefined;

  return {
    model: (raw.model as string) || DEFAULTS.model,
    activeHours: {
      start: activeHours?.start || DEFAULTS.activeHours.start,
      end: activeHours?.end || DEFAULTS.activeHours.end,
    },
    workspace,
  };
}
