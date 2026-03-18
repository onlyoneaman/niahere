import * as readline from "readline";
import { CronExpressionParser } from "cron-parser";
import { readState, readAudit } from "../utils/logger";
import { getConfig } from "../utils/config";
import { runJob } from "../core/runner";
import { localTime } from "../utils/time";
import { Job } from "../db/models";
import { withDb } from "../db/connection";
import type { ScheduleType } from "../types";
import { errMsg } from "../utils/errors";
import { fail, pickFromList } from "../utils/cli";
import { computeInitialNextRun } from "../core/scheduler";

async function pickJob(prompt = "Pick a job"): Promise<string> {
  let jobs: { name: string; schedule: string; enabled: boolean; prompt: string }[] = [];
  try {
    await withDb(async () => { jobs = await Job.list(); });
  } catch { /* DB unavailable */ }

  if (jobs.length === 0) {
    fail("No jobs found.");
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const items = jobs.map((j) => ({
      name: j.name,
      label: `${j.enabled ? "●" : "○"} ${j.name}  ${j.schedule}`,
    }));
    const name = await pickFromList(rl, items, prompt);
    if (!name) fail("Invalid selection.");
    return name;
  } finally {
    rl.close();
  }
}

export async function jobCommand(): Promise<void> {
  const subcommand = process.argv[3];

  switch (subcommand) {
    case "list": {
      try {
        await withDb(async () => {
          const jobs = await Job.list();
          if (jobs.length === 0) {
            console.log("No jobs configured. Use `nia job add` or `nia job import`.");
          } else {
            for (const job of jobs) {
              const tag = job.always ? "  always" : "";
              const type = job.scheduleType !== "cron" ? ` (${job.scheduleType})` : "";
              console.log(`  ${job.enabled ? "●" : "○"} ${job.name}  ${job.schedule}${type}${tag}`);
            }
          }
        });
      } catch (err) {
        fail(`Failed to list jobs: ${errMsg(err)}`);
      }
      break;
    }

    case "add": {
      const always = process.argv.includes("--always");
      let cliArgs = process.argv.slice(4).filter((a) => a !== "--always");

      // Parse --type flag
      let scheduleType: ScheduleType = "cron";
      const typeIdx = cliArgs.indexOf("--type");
      if (typeIdx !== -1 && cliArgs[typeIdx + 1]) {
        const val = cliArgs[typeIdx + 1];
        if (val === "cron" || val === "interval" || val === "once") {
          scheduleType = val;
          cliArgs.splice(typeIdx, 2);
        }
      }

      const name = cliArgs[0];
      const schedule = cliArgs[1];
      const prompt = cliArgs.slice(2).join(" ");

      if (!name || !schedule || !prompt) {
        console.log('Usage: nia job add <name> <schedule> <prompt> [--always] [--type cron|interval|once]');
        fail('Example: nia job add heartbeat "*/10 * * * *" Check system health --always');
      }

      // Validate schedule based on type
      if (scheduleType === "cron") {
        try { CronExpressionParser.parse(schedule); } catch { fail(`Invalid cron schedule: ${schedule}`); }
      }

      try {
        const config = getConfig();
        const nextRunAt = computeInitialNextRun(scheduleType, schedule, config.timezone);
        await withDb(async () => {
          await Job.create(name, schedule, prompt, always, scheduleType, nextRunAt);
          console.log(`Job "${name}" added (${scheduleType}: ${schedule}).${always ? " (runs 24/7)" : ""}`);
        });
      } catch (err) {
        fail(`Failed to add job: ${errMsg(err)}`);
      }
      break;
    }

    case "remove": {
      const name = process.argv[4];
      if (!name) fail("Usage: nia job remove <name>");

      try {
        await withDb(async () => {
          const removed = await Job.remove(name);
          console.log(removed ? `Job "${name}" removed.` : `Job not found: ${name}`);
        });
      } catch (err) {
        fail(`Failed to remove job: ${errMsg(err)}`);
      }
      break;
    }

    case "enable":
    case "disable": {
      const name = process.argv[4];
      if (!name) fail(`Usage: nia job ${subcommand} <name>`);
      const enabled = subcommand === "enable";

      try {
        await withDb(async () => {
          const updated = await Job.update(name, { enabled });
          console.log(updated ? `Job "${name}" ${subcommand}d.` : `Job not found: ${name}`);
        });
      } catch (err) {
        fail(`Failed: ${errMsg(err)}`);
      }
      break;
    }

    case "show": {
      const name = process.argv[4] || await pickJob("Show job");

      try {
        await withDb(async () => {
          const job = await Job.get(name);
          if (!job) fail(`Job not found: ${name}`);

          console.log(`  ${job.enabled ? "●" : "○"} ${job.name}`);
          console.log(`  schedule: ${job.schedule}`);
          console.log(`  enabled:  ${job.enabled}`);
          console.log(`  type:     ${job.always ? "cron (runs 24/7)" : "job (active hours only)"}`);
          console.log(`  prompt:   ${job.prompt}`);

          const state = readState();
          const info = state[job.name];
          if (info) {
            console.log(`\n  last run: ${localTime(new Date(info.lastRun))}`);
            console.log(`  status:   ${info.status}`);
            console.log(`  duration: ${info.duration_ms}ms`);
            if (info.error) console.log(`  error:    ${info.error}`);
          } else {
            console.log("\n  never run");
          }

          const entries = readAudit(job.name, 5);
          if (entries.length > 0) {
            console.log("\n  recent runs:");
            for (const e of entries) {
              const time = localTime(new Date(e.timestamp));
              const dur = `${e.duration_ms}ms`;
              const icon = e.status === "ok" ? "\u2713" : "\u2717";
              const summary = e.error || e.result.slice(0, 60).replace(/\n/g, " ") || "-";
              console.log(`    ${icon} ${time}  ${dur.padStart(8)}  ${summary}`);
            }
          }
        });
      } catch (err) {
        fail(`Failed: ${errMsg(err)}`);
      }
      break;
    }

    case "status": {
      const name = process.argv[4] || await pickJob("Job status");

      try {
        await withDb(async () => {
          const job = await Job.get(name);
          if (!job) fail(`Job not found: ${name}`);

          const state = readState();
          const info = state[job.name];
          const status = info
            ? `${info.status} (${localTime(new Date(info.lastRun))}, ${info.duration_ms}ms)`
            : "never run";
          const tag = job.always ? " always" : "";
          console.log(`  ${job.enabled ? "●" : "○"} ${job.name}  [${job.schedule}]${tag}  ${status}`);
          if (info?.error) console.log(`    error: ${info.error}`);
        });
      } catch (err) {
        fail(`Failed: ${errMsg(err)}`);
      }
      break;
    }

    case "run": {
      const name = process.argv[4];
      if (!name) fail("Usage: nia job run <name>");

      let found: { name: string; schedule: string; prompt: string } | null = null;
      try {
        await withDb(async () => { found = await Job.get(name); });
      } catch { /* DB unavailable */ }

      if (!found) fail(`Job not found: ${name}`);
      const job = found as { name: string; schedule: string; prompt: string };

      console.log(`Running job: ${job.name} (model: ${getConfig().model})`);
      const result = await runJob(job);
      console.log(`\nStatus: ${result.status}`);
      console.log(`Duration: ${result.duration_ms}ms`);
      if (result.result) console.log(`\nResult:\n${result.result}`);
      if (result.error) console.log(`\nError: ${result.error}`);
      break;
    }

    case "log": {
      const logName = process.argv[4];
      const entries = readAudit(logName, 20);
      if (entries.length === 0) {
        console.log(logName ? `No runs found for ${logName}` : "No job runs recorded yet.");
        break;
      }
      for (const e of entries) {
        const time = localTime(new Date(e.timestamp));
        const dur = `${e.duration_ms}ms`;
        const status = e.status === "ok" ? "\u2713" : "\u2717";
        const summary = e.error || e.result.slice(0, 80).replace(/\n/g, " ") || "-";
        console.log(`  ${status} ${time}  ${dur.padStart(8)}  ${e.job}  ${summary}`);
      }
      break;
    }

    default:
      console.log("Usage: nia job <list|show|status|add|remove|enable|disable|run|log|import>\n");
      console.log("  list                          — list all jobs");
      console.log("  show [name]                   — full job details + recent runs");
      console.log("  status [name]                 — quick status check");
      console.log("  add <name> <schedule> <prompt> — add a job (active hours only)")
      console.log("      --always                  — run 24/7 regardless of active hours");
      console.log("  remove <name>                 — delete a job");
      console.log("  enable <name>                 — enable a job");
      console.log("  disable <name>                — disable a job");
      console.log("  run <name>                    — run a job once");
      console.log("  log [name]                    — show recent run history");
      console.log("  import                        — import YAML jobs to DB");
      process.exit(subcommand ? 1 : 0);
  }
}
