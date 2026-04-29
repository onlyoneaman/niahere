import { isAbsolute, relative, resolve } from "path";

import { getPaths } from "./paths";

export function getJobDir(jobName: string): string {
  const jobsDir = resolve(getPaths().jobsDir);
  const jobDir = resolve(jobsDir, jobName);
  const rel = relative(jobsDir, jobDir);

  if (!rel || rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`Invalid job name "${jobName}": job workspace must stay inside ${jobsDir}`);
  }

  return jobDir;
}

export function validateJobName(jobName: string): void {
  getJobDir(jobName);
}
