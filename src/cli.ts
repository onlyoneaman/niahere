#!/usr/bin/env bun
import { resolve } from "path";
import { isRunning, readPid, runDaemon, startDaemon, stopDaemon } from "./daemon";
import { readState } from "./logger";
import { parseJobs } from "./cron";
import { loadConfig } from "./config";
import { runJob } from "./runner";

const workspace = resolve(import.meta.dir, "..");
const command = process.argv[2];

switch (command) {
  case "start": {
    if (isRunning(workspace)) {
      const pid = readPid(workspace);
      console.log(`nia is already running (pid: ${pid})`);
      process.exit(1);
    }
    const pid = startDaemon(workspace);
    console.log(`nia started (pid: ${pid})`);
    break;
  }

  case "stop": {
    if (!isRunning(workspace)) {
      console.log("nia is not running");
      process.exit(1);
    }
    stopDaemon(workspace);
    console.log("nia stopped");
    break;
  }

  case "status": {
    const running = isRunning(workspace);
    const pid = readPid(workspace);
    console.log(`nia: ${running ? `running (pid: ${pid})` : "stopped"}`);

    const state = readState(workspace);
    const entries = Object.entries(state);
    if (entries.length > 0) {
      console.log("\nJobs:");
      for (const [name, info] of entries) {
        console.log(`  ${name}: ${info.status} (last: ${info.lastRun}, ${info.duration_ms}ms)`);
      }
    }
    break;
  }

  case "run": {
    // Foreground mode — used by daemon's child process
    await runDaemon(workspace);
    break;
  }

  case "job": {
    const jobName = process.argv[3];
    if (!jobName) {
      console.log("Usage: nia job <name>");
      process.exit(1);
    }
    const config = loadConfig(workspace);
    const jobs = parseJobs(workspace);
    const job = jobs.find((j) => j.name === jobName);
    if (!job) {
      console.log(`Job not found: ${jobName}`);
      console.log(`Available: ${jobs.map((j) => j.name).join(", ")}`);
      process.exit(1);
    }
    console.log(`Running job: ${job.name} (model: ${config.model})`);
    const result = await runJob(workspace, job, config.model);
    console.log(`\nStatus: ${result.status}`);
    console.log(`Duration: ${result.duration_ms}ms`);
    if (result.result) console.log(`\nResult:\n${result.result}`);
    if (result.error) console.log(`\nError: ${result.error}`);
    break;
  }

  default:
    console.log("Usage: nia <start|stop|status|job>");
    process.exit(1);
}
