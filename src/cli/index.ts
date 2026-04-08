#!/usr/bin/env bun
import { existsSync, mkdirSync } from "fs";
import {
  isRunning,
  readPid,
  runDaemon,
  startDaemon,
  stopDaemon,
} from "../core/daemon";
import { getConfig } from "../utils/config";
import { localTime } from "../utils/time";
import { startRepl } from "../chat/repl";
import { Message } from "../db/models";
import { withDb } from "../db/connection";
import { getNiaHome, getPaths } from "../utils/paths";
import { errMsg } from "../utils/errors";
import { fail, ICON_PASS, ICON_WARN } from "../utils/cli";
import { jobCommand } from "./job";
import { statusCommand } from "./status";
import { sendCommand, telegramCommand, slackCommand } from "./channels";
import { rulesCommand, memoryCommand } from "./self";
import { watchCommand } from "./watch";
import { agentCommand } from "./agent";

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
if (
  command &&
  !["init", "help", "version", "-v", "--version", "-h", "--help"].includes(
    command,
  )
) {
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
    if (config.channels.telegram.bot_token) expecting.add("telegram");
    if (config.channels.slack.bot_token && config.channels.slack.app_token)
      expecting.add("slack");
  }
  expecting.add("scheduler");

  if (expecting.size === 0) return;

  const { readFileSync } = await import("fs");
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
    // Unregister service first to prevent KeepAlive from respawning after kill
    const { unregisterService } = await import("../commands/service");
    await unregisterService();
    stopDaemon();
    console.log("nia stopped");
    break;
  }

  case "status": {
    await statusCommand(process.argv.slice(3));
    break;
  }

  case "health": {
    const { healthCommand } = await import("../commands/health");
    await healthCommand();
    break;
  }

  case "restart": {
    const { isServiceInstalled, restartService } =
      await import("../commands/service");
    if (isServiceInstalled()) {
      // Service-aware: unload (stops KeepAlive respawn), kill, then reload
      await restartService();
    } else {
      stopDaemon();
      startDaemon();
    }
    const restartPid = readPid();
    console.log(
      `nia restarting${restartPid ? ` (pid: ${restartPid})` : ""}...`,
    );
    await awaitStartup();
    console.log("nia restarted");
    break;
  }

  case "run": {
    const prompt = process.argv.slice(3).join(" ");
    if (prompt) {
      const { createChatEngine } = await import("../chat/engine");
      const { getMcpServers } = await import("../mcp");
      const {
        DIM,
        RESET: RST,
        CLEAR_LINE,
        SPINNER: FRAMES,
      } = await import("../utils/cli");
      let frame = 0;
      let statusText = "thinking";
      let spinTimer: ReturnType<typeof setInterval> | null = null;
      let streamedLen = 0;
      let streaming = false;

      const renderSpinner = () => {
        process.stderr.write(
          `${CLEAR_LINE}${DIM}  ${FRAMES[frame]} ${statusText}${RST}`,
        );
        frame = (frame + 1) % FRAMES.length;
      };

      await withDb(async () => {
        const engine = await createChatEngine({
          room: "cli-run",
          channel: "terminal",
          resume: false,
          mcpServers: getMcpServers(),
        });
        spinTimer = setInterval(renderSpinner, 80);
        renderSpinner();

        const { result, costUsd, turns } = await engine.send(prompt, {
          onStream(textSoFar) {
            if (!streaming) {
              if (spinTimer) {
                clearInterval(spinTimer);
                spinTimer = null;
              }
              process.stderr.write("\x1b[2K\r");
              streaming = true;
            }
            const chunk = textSoFar.slice(streamedLen);
            if (chunk) {
              process.stdout.write(chunk);
              streamedLen = textSoFar.length;
            }
          },
          onActivity(text) {
            if (!streaming) statusText = text;
          },
        });

        if (spinTimer) {
          clearInterval(spinTimer);
          spinTimer = null;
        }

        if (!streaming && result.trim()) {
          process.stderr.write("\x1b[2K\r");
          process.stdout.write(result.trim());
        } else if (streaming) {
          const rest = result.slice(streamedLen);
          if (rest.trim()) process.stdout.write(rest);
        } else {
          process.stderr.write("\x1b[2K\r");
        }

        const costStr = costUsd > 0 ? `$${costUsd.toFixed(4)}` : "";
        const turnsStr =
          turns > 0 ? `${turns} turn${turns !== 1 ? "s" : ""}` : "";
        const meta = [costStr, turnsStr].filter(Boolean).join(" · ");
        if (meta) process.stderr.write(`\n${DIM}${meta}${RST}`);
        process.stdout.write("\n");

        engine.close();
      });
      process.exit(0);
    } else {
      await runDaemon();
    }
    break;
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
    const room = process.argv[3];
    try {
      await withDb(async () => {
        const messages = await Message.getRecent(20, room);
        if (messages.length === 0) {
          console.log("No messages yet.");
        } else {
          for (const m of messages) {
            const time = localTime(new Date(m.createdAt));
            const prefix = m.sender === "user" ? "you" : m.sender;
            const roomTag = room ? "" : `[${m.room}] `;
            const snippet =
              m.content.length > 120
                ? m.content.slice(0, 120) + "..."
                : m.content;
            console.log(
              `  ${roomTag}${time}  ${prefix} > ${snippet.replace(/\n/g, " ")}`,
            );
          }
        }
      });
    } catch (err) {
      fail(`Failed: ${errMsg(err)}`);
    }
    break;
  }

  case "logs": {
    const { daemonLog } = getPaths();
    if (!existsSync(daemonLog)) fail("No daemon log found. Is nia running?");
    const logArgs = process.argv.slice(3);
    const follow = logArgs.includes("-f") || logArgs.includes("--follow");
    // --channel <name> filters logs by channel/component via grep
    const chIdx = logArgs.indexOf("--channel");
    const channelFilter =
      chIdx !== -1 && logArgs[chIdx + 1] ? logArgs[chIdx + 1] : null;

    if (channelFilter) {
      // Pipe through grep to filter by channel name in structured logs
      const tailArgs = follow
        ? ["tail", "-f", daemonLog]
        : ["tail", "-200", daemonLog];
      const tail = Bun.spawn(tailArgs, {
        stdio: ["ignore", "pipe", "inherit"],
      });
      const grep = Bun.spawn(["grep", "-i", channelFilter], {
        stdio: [tail.stdout, "inherit", "inherit"],
      });
      await grep.exited;
    } else {
      const args = follow
        ? ["tail", "-f", daemonLog]
        : ["tail", "-50", daemonLog];
      const proc = Bun.spawn(args, { stdio: ["ignore", "inherit", "inherit"] });
      await proc.exited;
    }
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
    const chIdx = chatArgs.indexOf("--channel");
    const simChannel =
      chIdx !== -1 && chatArgs[chIdx + 1] ? chatArgs[chIdx + 1] : undefined;
    await startRepl(mode, simChannel);
    break;
  }

  case "agent": {
    await agentCommand();
    break;
  }

  case "skills": {
    const { scanSkills: loadSkills } = await import("../core/skills");
    const filter = process.argv[3]; // e.g. "project", "nia", "shared", "claude"
    let skills = loadSkills();
    if (filter) {
      skills = skills.filter((s) => s.source === filter);
    }
    if (skills.length === 0) {
      console.log(
        filter ? `No skills found in "${filter}".` : "No skills found.",
      );
    } else {
      for (const s of skills) {
        const tag = filter ? "" : `  [${s.source}]`;
        console.log(`  ${s.name}${tag}`);
      }
    }
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

  case "config": {
    const configSub = process.argv[3];
    const configKey = process.argv[4];
    const configVal = process.argv.slice(5).join(" ");
    const { readRawConfig, updateRawConfig } = await import("../utils/config");

    if (configSub === "set" && configKey) {
      if (!configVal) fail("Usage: nia config set <key> <value>");
      // Support dot notation for nested keys (e.g. channels.default)
      const parts = configKey.split(".");
      let obj: Record<string, unknown> = {};
      let cursor = obj;
      for (let i = 0; i < parts.length - 1; i++) {
        cursor[parts[i]] = {};
        cursor = cursor[parts[i]] as Record<string, unknown>;
      }
      // Auto-detect booleans and numbers
      let parsed: unknown = configVal;
      if (configVal === "true") parsed = true;
      else if (configVal === "false") parsed = false;
      else if (/^\d+$/.test(configVal)) parsed = Number(configVal);
      cursor[parts[parts.length - 1]] = parsed;
      updateRawConfig(obj);
      console.log(`${configKey} = ${configVal}`);
    } else if (configSub === "get" && configKey) {
      const raw = readRawConfig();
      const parts = configKey.split(".");
      let val: unknown = raw;
      for (const p of parts) {
        if (val && typeof val === "object")
          val = (val as Record<string, unknown>)[p];
        else {
          val = undefined;
          break;
        }
      }
      if (val === undefined) {
        console.log(`${configKey}: (not set)`);
      } else if (typeof val === "object") {
        const yaml = (await import("js-yaml")).default;
        console.log(yaml.dump(val, { lineWidth: -1 }).trim());
      } else {
        console.log(`${configKey} = ${val}`);
      }
    } else if (!configSub || configSub === "list") {
      const raw = readRawConfig();
      const yaml = (await import("js-yaml")).default;
      console.log(yaml.dump(raw, { lineWidth: -1 }).trim());
    } else {
      console.log("Usage: nia config <set|get|list>");
      console.log("  nia config set <key> <value>  — set a config value");
      console.log("  nia config get <key>          — get a config value");
      console.log("  nia config list               — show all config");
    }
    break;
  }

  case "channels": {
    const sub = process.argv[3];
    const { updateRawConfig } = await import("../utils/config");
    if (sub === "on" || sub === "off") {
      const enabled = sub === "on";
      updateRawConfig({ channels: { enabled } });
      const pid = readPid();
      if (pid && isRunning()) {
        process.kill(pid, "SIGHUP");
        console.log(`channels ${enabled ? "enabled" : "disabled"}`);
      } else {
        console.log(
          `channels ${enabled ? "enabled" : "disabled"} — start nia to apply`,
        );
      }
    } else {
      console.log(`channels: ${getConfig().channels.enabled ? "on" : "off"}`);
    }
    break;
  }

  case "db": {
    const { dbCommand } = await import("../commands/db");
    await dbCommand();
    break;
  }

  case "test": {
    const verbose =
      process.argv.includes("-v") || process.argv.includes("--verbose");
    const extraArgs = process.argv
      .slice(3)
      .filter((a) => a !== "-v" && a !== "--verbose");
    const proc = Bun.spawn(["bun", "test", ...extraArgs], {
      stdio: ["ignore", "pipe", "pipe"],
      cwd: import.meta.dir + "/../..",
      env: { ...process.env, LOG_LEVEL: "silent" },
    });

    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    const exitCode = await proc.exited;
    const output = stdout + stderr;

    if (verbose) {
      process.stdout.write(output);
    } else {
      for (const line of output.split("\n")) {
        if (
          /^\s*\d+ pass/.test(line) ||
          /^\s*\d+ fail/.test(line) ||
          /^Ran \d+ tests/.test(line) ||
          /expect\(\) calls/.test(line)
        ) {
          console.log(line);
        } else if (/^✗|FAIL|error:/i.test(line.trim())) {
          console.log(line);
        }
      }
    }
    process.exit(exitCode);
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
    const { version: currentVersion } = await import("../../package.json");
    console.log(`Current: v${currentVersion}`);
    // Auto-backup before update
    try {
      const { createBackup } = await import("../commands/backup");
      console.log("Backing up...");
      await createBackup(true);
      console.log("✓ pre-update backup created");
    } catch (err) {
      console.log(`⚠ backup skipped: ${errMsg(err)}`);
    }
    console.log("Updating...");
    const install = Bun.spawn(["npm", "i", "-g", "niahere@latest"], {
      stdio: ["ignore", "inherit", "inherit"],
    });
    const installExit = await install.exited;
    if (installExit !== 0) {
      fail("Update failed.");
    }
    // Get new version
    const check = Bun.spawn(["npm", "view", "niahere", "version"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const newVersion = (await new Response(check.stdout).text()).trim();
    await check.exited;
    if (newVersion === currentVersion) {
      console.log("Already on latest.");
    } else {
      console.log(`Updated: v${currentVersion} → v${newVersion}`);
      if (isRunning()) {
        console.log("Restarting daemon...");
        const { isServiceInstalled, restartService } =
          await import("../commands/service");
        if (isServiceInstalled()) {
          await restartService();
        } else {
          stopDaemon();
          startDaemon();
        }
        console.log("Restarted.");
      }
    }
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
  stop                            Stop daemon + unregister service
  restart                         Restart daemon
  status [--json --rooms N --all] Show daemon, jobs, channels
  health                          Check daemon, db, channels, config
  logs [-f] [--channel ch]        Daemon logs (filter by channel)

Chat:
  chat [-c] [-r] [--channel ch]   Interactive chat (new session by default)
  run <prompt>                    One-shot execution
  history [room]                  Recent messages
  send [-c ch] <msg>              Send a message via channel

Jobs:
  job <sub>                       Manage jobs (list|add|update|remove|run|...)

Persona:
  rules [show|reset]              View or reset rules.md
  memory [show|reset]             View or reset memory.md
  agent <sub>                     List/show agents
  skills [source]                 List available skills

Channels:
  channels [on|off]               Toggle channels
  watch <sub>                     Manage Slack watch channels
  telegram <token>                Configure telegram
  slack <bot> <app>               Configure slack

System:
  config <set|get|list>           Manage config values
  backup [list]                   Create or list backups
  validate                        Validate config.yaml
  db <sub>                        Database setup/status/migrate
  update                          Update to latest version
  init                            Initial setup
  test [-v]                       Run tests`;

    console.log(HELP);
    // Unknown command → exit 1, help/no command → exit 0
    const isHelp =
      !command ||
      command === "help" ||
      command === "--help" ||
      command === "-h";
    if (!isHelp) console.error(`\nUnknown command: ${command}`);
    process.exit(isHelp ? 0 : 1);
  }
}
