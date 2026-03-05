import { resolve } from "path";

export interface Paths {
  workspace: string;
  pid: string;
  daemonLog: string;
  cronState: string;
  cronAudit: string;
  config: string;
  jobsDir: string;
  selfDir: string;
}

export function getPaths(workspace: string): Paths {
  return {
    workspace,
    pid: resolve(workspace, "tmp/nia.pid"),
    daemonLog: resolve(workspace, "tmp/daemon.log"),
    cronState: resolve(workspace, "tmp/cron-state.json"),
    cronAudit: resolve(workspace, "tmp/cron-audit.jsonl"),
    config: resolve(workspace, "nia.yaml"),
    jobsDir: resolve(workspace, "jobs"),
    selfDir: resolve(workspace, "self"),
  };
}
