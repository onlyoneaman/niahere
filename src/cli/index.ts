#!/usr/bin/env bun
import { mkdirSync, readFileSync } from "fs";
import { isRunning, readPid, runDaemon, startDaemon, stopDaemon } from "../core/daemon";
import { getConfig } from "../utils/config";
import { startRepl } from "../chat/repl";
import { getNiaHome, getPaths } from "../utils/paths";
import { fail, ICON_PASS, ICON_WARN } from "../utils/cli";
import { jobCommand } from "./job";
import { statusCommand } from "./status";
import { activeCommand } from "./active";
import { modelCommand } from "./model";
import { sendCommand, telegramCommand, slackCommand } from "./channels";
import { phoneCommand } from "./phone";
import { rulesCommand, memoryCommand } from "./self";
import { watchCommand } from "./watch";
import { agentCommand } from "./agent";
import { employeeCommand } from "./employee";
import { guardActiveEngines, parseGuardFlags } from "../core/engine-guard";

// Set LOG_LEVEL from config before anything else logs
try {
  const config = getConfig();
  if (config.log_level) {
    process.env.LOG_LEVEL = config.log_level;
  }
} catch {
  // config.yaml may not exist yet (e.g. before `nia init`)
}

const command = process.argv[2];

// Ensure ~/.niahere/ exists for commands that need it
if (command && !["init", "help", "version", "-v", "--version", "-h", "--help"].includes(command)) {
  mkdirSync(getNiaHome(), { recursive: true });
}

const STARTUP_MARKERS: Record<string, string> = {
  telegram: "telegram bot polling started",
  slack: "slack bot started",
  scheduler: "scheduler started",
};

async function awaitStartup(timeout = 60_000): Promise<void> {
  const { daemonLog } = getPaths();
  const config = getConfig();
  const expecting = new Set<string>();
  if (config.channels.enabled) {
    if (config.channels.telegram.enabled && config.channels.telegram.bot_token) expecting.add("telegram");
    if (config.channels.slack.enabled && config.channels.slack.bot_token && config.channels.slack.app_token) {
      expecting.add("slack");
    }
  }
  expecting.add("scheduler");

  if (expecting.size === 0) return;

  const ready = new Set<string>();
  let logOffset = 0;
  try {
    logOffset = readFileSync(daemonLog, "utf8").length;
  } catch {}

  const startTime = Date.now();
  while (ready.size < expecting.size && Date.now() - startTime < timeout) {
    await new Promise((r) => setTimeout(r, 500));
    let content = "";
    try {
      content = readFileSync(daemonLog, "utf8").slice(logOffset);
    } catch {
      continue;
    }

    for (const name of expecting) {
      if (ready.has(name)) continue;
      if (content.includes(STARTUP_MARKERS[name])) {
        ready.add(name);
        console.log(`  ${ICON_PASS} ${name}`);
      }
    }
  }

  const pending = [...expecting].filter((e) => !ready.has(e));
  if (pending.length > 0) {
    console.log(`  ${ICON_WARN} timed out waiting for: ${pending.join(", ")}`);
  }
}

switch (command) {
  case "version":
  case "-v":
  case "--version": {
    const { version } = await import("../../package.json");
    console.log(`nia v${version}`);
    break;
  }

  case "start": {
    if (isRunning()) fail(`nia is already running (pid: ${readPid()})`);
    const { registerService } = await import("../commands/service");
    await registerService(); // launchd/systemd starts the daemon via RunAtLoad/enable --now
    // Give service manager a moment to spawn the process and write pidfile
    await new Promise((r) => setTimeout(r, 1000));
    // Only spawn manually if no service manager picked it up
    if (!isRunning()) {
      startDaemon();
    }
    const pid = readPid();
    console.log(`nia starting${pid ? ` (pid: ${pid})` : ""}...`);
    await awaitStartup();
    console.log("nia started");
    break;
  }

  case "stop": {
    if (!isRunning()) fail("nia is not running");
    const stopGuard = parseGuardFlags(process.argv.slice(3));
    if (!(await guardActiveEngines("stop", stopGuard))) process.exit(1);
    const { unregisterService } = await import("../commands/service");
    await unregisterService({ force: stopGuard.force });
    stopDaemon({ force: stopGuard.force });
    console.log("nia stopped");
    break;
  }

  case "status": {
    await statusCommand(process.argv.slice(3));
    break;
  }

  case "active": {
    await activeCommand(process.argv.slice(3));
    break;
  }

  case "model": {
    await modelCommand(process.argv.slice(3));
    break;
  }

  case "health": {
    const { healthCommand } = await import("../commands/health");
    await healthCommand();
    break;
  }

  case "restart": {
    const restartGuard = parseGuardFlags(process.argv.slice(3));
    if (!(await guardActiveEngines("restart", restartGuard))) process.exit(1);
    const { isServiceInstalled, restartService } = await import("../commands/service");
    if (isServiceInstalled()) {
      await restartService({ force: restartGuard.force });
    } else {
      stopDaemon({ force: restartGuard.force });
      startDaemon();
    }
    const restartPid = readPid();
    console.log(`nia restarting${restartPid ? ` (pid: ${restartPid})` : ""}...`);
    await awaitStartup();
    console.log("nia restarted");
    break;
  }

  case "run": {
    const prompt = process.argv.slice(3).join(" ");
    if (!prompt) {
      await runDaemon();
      break;
    }
    const { runPrompt } = await import("./run");
    await runPrompt(prompt);
    process.exit(0);
  }

  case "job": {
    await jobCommand();
    break;
  }

  case "rules": {
    rulesCommand();
    break;
  }

  case "memory": {
    memoryCommand();
    break;
  }

  case "watch": {
    watchCommand();
    break;
  }

  case "history": {
    const { historyCommand } = await import("./logs");
    await historyCommand(process.argv[3]);
    break;
  }

  case "logs": {
    const { logsCommand } = await import("./logs");
    await logsCommand(process.argv.slice(3));
    break;
  }

  case "seed": {
    await import("../db/seed");
    break;
  }

  case "chat": {
    const chatArgs = process.argv.slice(3);
    const mode =
      chatArgs.includes("--continue") || chatArgs.includes("-c")
        ? ("continue" as const)
        : chatArgs.includes("--resume") || chatArgs.includes("-r")
          ? ("pick" as const)
          : ("new" as const);
    const flagVal = (flag: string) => {
      const idx = chatArgs.indexOf(flag);
      return idx !== -1 && chatArgs[idx + 1] ? chatArgs[idx + 1] : undefined;
    };
    const simChannel = flagVal("--channel");
    const context = {
      employee: flagVal("--employee"),
      agent: flagVal("--agent"),
      job: flagVal("--job"),
    };
    const hasContext = context.employee || context.agent || context.job;
    await startRepl(mode, simChannel, hasContext ? context : undefined);
    break;
  }

  case "agent": {
    await agentCommand();
    break;
  }

  case "employee": {
    await employeeCommand();
    break;
  }

  case "skills": {
    const { skillsCommand } = await import("./skills");
    skillsCommand(process.argv[3]);
    break;
  }

  case "send": {
    await sendCommand();
    break;
  }

  case "telegram": {
    telegramCommand();
    break;
  }

  case "slack": {
    await slackCommand();
    break;
  }

  case "phone": {
    await phoneCommand();
    break;
  }

  case "config": {
    const { configCommand } = await import("./config");
    await configCommand(process.argv[3], process.argv[4], process.argv.slice(5).join(" "));
    break;
  }

  case "channels": {
    const sub = process.argv[3];
    if (sub !== "on" && sub !== "off") {
      console.log(`channels: ${getConfig().channels.enabled ? "on" : "off"}`);
      break;
    }
    const { channelsToggleCommand } = await import("./update");
    await channelsToggleCommand(sub, process.argv[4]);
    break;
  }

  case "db": {
    const { dbCommand } = await import("../commands/db");
    await dbCommand();
    break;
  }

  case "test": {
    const { testCommand } = await import("./test");
    await testCommand(process.argv.slice(3));
  }

  case "backup": {
    const { backupCommand } = await import("../commands/backup");
    await backupCommand();
    break;
  }

  case "validate": {
    const { validateConfig } = await import("../commands/validate");
    const result = validateConfig();
    for (const msg of result.messages) console.log(`  ${msg}`);
    console.log(result.ok ? "\nConfig is valid." : "\nConfig has errors.");
    process.exit(result.ok ? 0 : 1);
  }

  case "update": {
    const { updateCommand } = await import("./update");
    await updateCommand(process.argv.slice(3));
    break;
  }

  case "init": {
    const { runInit } = await import("../commands/init");
    await runInit();
    break;
  }

  case "help":
  case "--help":
  case "-h":
  default: {
    const HELP = `Usage: nia <command>

Daemon:
  start                           Start daemon + register service
  stop [--wait N] [--force]       Stop daemon (guards active engines)
  restart [--wait N] [--force]    Restart daemon
  update [--wait N] [--force]     Update to latest version
  status [--json --rooms N --all] Show daemon, jobs, channels
  active [--full]                 Show active engine count or details
  model [name]                    Show or set global Claude model
  health                          Check daemon, db, channels, config
  logs [-f] [--channel ch]        Daemon logs (filter by channel)

Chat:
  chat [-c] [-r] [--employee|--agent|--job name]  Interactive chat
  run <prompt>                    One-shot execution
  history [room]                  Recent messages
  send [-c ch] [--to C --thread T] <msg>  Send message (DM, channel, or thread)

Jobs:
  job <sub>                       Manage jobs (list|add|update|remove|run|...)

Persona:
  rules [show|reset]              View or reset rules.md
  memory [show|reset]             View or reset memory.md
  agent <sub>                     List/show agents
  employee <sub>                  Manage employees
  skills [source]                 List available skills

Channels:
  channels [on|off] [name]        Toggle all channels or one channel
  watch <sub>                     Manage Slack watch channels
  telegram [setup]                Configure telegram
  slack [setup]                   Configure slack

System:
  config <set|get|list>           Manage config values
  backup [list]                   Create or list backups
  validate                        Validate config.yaml
  db <sub>                        Database setup/status/migrate
  init                            Initial setup
  test [-v]                       Run tests`;

    console.log(HELP);
    // Unknown command → exit 1, help/no command → exit 0
    const isHelp = !command || command === "help" || command === "--help" || command === "-h";
    if (!isHelp) console.error(`\nUnknown command: ${command}`);
    process.exit(isHelp ? 0 : 1);
  }
}
