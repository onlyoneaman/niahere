import { resolve } from "path";
import { homedir } from "os";
import type { Paths } from "../types";

export function getNiaHome(): string {
  return process.env.NIA_HOME || resolve(homedir(), ".niahere");
}

export function getPaths(): Paths {
  const home = getNiaHome();
  return {
    home,
    pid: resolve(home, "tmp/nia.pid"),
    daemonLog: resolve(home, "tmp/daemon.log"),
    cronState: resolve(home, "tmp/cron-state.json"),
    cronAudit: resolve(home, "tmp/cron-audit.jsonl"),
    config: resolve(home, "config.yaml"),
    jobsDir: resolve(home, "jobs"),
    selfDir: resolve(home, "self"),
    beadsDir: resolve(home, "beads"),
    skillsDir: resolve(home, "skills"),
    imagesDir: resolve(home, "images"),
    watchesDir: resolve(home, "watches"),
  };
}
