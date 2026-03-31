import * as readline from "readline";
import { readState, readAudit } from "../utils/logger";
import { getConfig } from "../utils/config";
import { runJob } from "../core/runner";
import { localTime } from "../utils/time";
import { formatDuration } from "../utils/format";
import { Job } from "../db/models";
import { withDb } from "../db/connection";
import type { ScheduleType } from "../types";
import { errMsg } from "../utils/errors";
import { fail, parseArgs, pickFromList, ICON_PASS, ICON_FAIL } from "../utils/cli";
import { computeInitialNextRun } from "../core/scheduler";

const HELP = `Usage: nia job <command>

Commands:
  list                          List all jobs
  show [name]                   Full job details + recent runs
  status [name]                 Quick status check
  add <name> <schedule> <prompt>  Add a job
      --type cron|interval|once   Schedule type (default: cron)
      --always                    Run 24/7 regardless of active hours
      --agent <name>              Assign an agent to the job
  update <name>                 Update a job
      --schedule <schedule>       New schedule
      --prompt <prompt>           New prompt
      --type cron|interval|once   Change schedule type
      --always / --no-always      Toggle 24/7 mode
      --agent <name>              Assign agent (--no-agent to remove)
  remove <name>                 Delete a job
  enable <name>                 Enable a job
  disable <name>                Disable a job
  run <name>                    Run a job once
  log [name]                    Show recent run history`;

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

  if (!subcommand || subcommand === "help" || subcommand === "--help" || subcommand === "-h") {
    console.log(HELP);
    process.exit(subcommand ? 0 : 0);
  }

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
              const agentTag = job.agent ? `  [${job.agent}]` : "";
              console.log(`  ${job.enabled ? "●" : "○"} ${job.name}  ${job.schedule}${type}${tag}${agentTag}`);
            }
          }
        });
      } catch (err) {
        fail(`Failed to list jobs: ${errMsg(err)}`);
      }
      break;
    }

    case "add": {
      const args = parseArgs(process.argv.slice(4), ["always"]);
      if (args.help) { console.log(HELP); return; }

      const scheduleType = (args.getString("type") || "cron") as ScheduleType;
      if (!["cron", "interval", "once"].includes(scheduleType)) {
        fail(`Invalid --type: "${scheduleType}". Must be cron, interval, or once.`);
      }

      const always = args.getBool("always") ?? false;
      const agent = args.getString("agent");

      const [name, schedule, ...promptParts] = args.positional;
      const prompt = promptParts.join(" ");

      if (!name || !schedule || !prompt) {
        console.error('Usage: nia job add <name> <schedule> <prompt> [--always] [--type cron|interval|once] [--agent <name>]');
        fail('Example: nia job add heartbeat "*/10 * * * *" Check system health --always');
      }

      try {
        const config = getConfig();
        const nextRunAt = computeInitialNextRun(scheduleType, schedule, config.timezone);
        await withDb(async () => {
          await Job.create(name, schedule, prompt, always, scheduleType, nextRunAt, agent);
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

    case "update": {
      const args = parseArgs(process.argv.slice(4), ["always"]);
      if (args.help) { console.log(HELP); return; }

      const name = args.positional[0];
      if (!name) {
        console.error('Usage: nia job update <name> [--schedule <s>] [--prompt <p>] [--type <t>] [--always] [--no-always]');
        fail('Example: nia job update curator --schedule "4h" --prompt "New prompt"');
      }

      const fields: Partial<{ schedule: string; prompt: string; always: boolean; scheduleType: ScheduleType; agent: string | null }> = {};
      const schedule = args.getString("schedule");
      const prompt = args.getString("prompt");
      const scheduleType = args.getString("type") as ScheduleType | undefined;
      const always = args.getBool("always");
      const agent = args.getString("agent");
      const noAgent = args.getBool("agent");

      if (schedule) fields.schedule = schedule;
      if (prompt) fields.prompt = prompt;
      if (scheduleType) {
        if (!["cron", "interval", "once"].includes(scheduleType)) {
          fail(`Invalid --type: "${scheduleType}". Must be cron, interval, or once.`);
        }
        fields.scheduleType = scheduleType;
      }
      if (always !== undefined) fields.always = always;
      if (agent) fields.agent = agent;
      if (noAgent === false) fields.agent = null;

      if (Object.keys(fields).length === 0) {
        fail("Nothing to update. Pass at least one flag (--schedule, --prompt, --type, --always, --agent).");
      }

      try {
        await withDb(async () => {
          const updated = await Job.update(name, fields);
          if (!updated) fail(`Job not found: "${name}". Use \`nia job list\` to see available jobs.`);
          console.log(`Job "${name}" updated.`);
        });
      } catch (err) {
        fail(`Failed to update job: ${errMsg(err)}`);
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
          console.log(`  schedule: ${job.schedule} (${job.scheduleType})`);
          console.log(`  enabled:  ${job.enabled}`);
          console.log(`  always:   ${job.always}`);
          if (job.agent) console.log(`  agent:    ${job.agent}`);
          console.log(`  prompt:   ${job.prompt}`);

          const state = readState();
          const info = state[job.name];
          if (info) {
            console.log(`\n  last run: ${localTime(new Date(info.lastRun))}`);
            console.log(`  status:   ${info.status}`);
            console.log(`  duration: ${formatDuration(info.duration_ms)}`);
            if (info.error) console.log(`  error:    ${info.error}`);
          } else {
            console.log("\n  never run");
          }

          const entries = readAudit(job.name, 5);
          if (entries.length > 0) {
            console.log("\n  recent runs:");
            for (const e of entries) {
              const time = localTime(new Date(e.timestamp));
              const dur = `${formatDuration(e.duration_ms)}`;
              const icon = e.status === "ok" ? ICON_PASS : ICON_FAIL;
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
            ? `${info.status} (${localTime(new Date(info.lastRun))}, ${formatDuration(info.duration_ms)})`
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

      console.log(`Running job: ${job.name} (model: ${getConfig().model})\n`);

      const MAX_LOG_LINES = 15;
      const logLines: string[] = [];
      let linesRendered = 0;

      function renderActivity(line: string) {
        logLines.push(line);
        if (logLines.length > MAX_LOG_LINES) logLines.shift();

        // Clear previously rendered lines
        if (linesRendered > 0) {
          process.stdout.write(`\x1b[${linesRendered}A\x1b[J`);
        }

        // Render current log lines
        const output = logLines.map((l, i) => {
          const dim = i < logLines.length - 1;
          return dim ? `  \x1b[2m${l}\x1b[0m` : `  \x1b[36m▸\x1b[0m ${l}`;
        }).join("\n");

        process.stdout.write(output + "\n");
        linesRendered = logLines.length;
      }

      const result = await runJob(job, renderActivity);

      // Clear the activity log and show final result
      if (linesRendered > 0) {
        process.stdout.write(`\x1b[${linesRendered}A\x1b[J`);
      }

      console.log(`Status: ${result.status}`);
      console.log(`Duration: ${formatDuration(result.duration_ms)}`);
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
        const dur = `${formatDuration(e.duration_ms)}`;
        const status = e.status === "ok" ? ICON_PASS : ICON_FAIL;
        const summary = e.error || e.result.slice(0, 80).replace(/\n/g, " ") || "-";
        console.log(`  ${status} ${time}  ${dur.padStart(8)}  ${e.job}  ${summary}`);
      }
      break;
    }

    default:
      console.error(`Unknown subcommand: ${subcommand}`);
      console.log(HELP);
      process.exit(1);
  }
}
