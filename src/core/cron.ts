import { existsSync, readdirSync, readFileSync } from "fs";
import { basename, join } from "path";
import yaml from "js-yaml";
import { getPaths } from "../utils/paths";

export interface Job {
  name: string;
  schedule: string;
  enabled: boolean;
  prompt: string;
}

export function parseJobs(workspace: string): Job[] {
  const { jobsDir } = getPaths(workspace);
  if (!existsSync(jobsDir)) return [];

  const files = readdirSync(jobsDir).filter((f) => f.endsWith(".yaml")).sort();
  const jobs: Job[] = [];

  for (const file of files) {
    const raw = yaml.load(readFileSync(join(jobsDir, file), "utf8")) as Record<string, unknown> | null;
    if (!raw || typeof raw !== "object") continue;
    if (!raw.schedule || !raw.prompt) continue;

    jobs.push({
      name: basename(file, ".yaml"),
      schedule: String(raw.schedule),
      enabled: raw.enabled !== false,
      prompt: String(raw.prompt).trim(),
    });
  }

  return jobs;
}
