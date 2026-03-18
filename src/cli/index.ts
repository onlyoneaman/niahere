#!/usr/bin/env bun
import { existsSync, mkdirSync } from "fs";
import { isRunning, readPid, runDaemon, startDaemon, stopDaemon } from "../core/daemon";
import { getConfig } from "../utils/config";
import { localTime } from "../utils/time";
import { startRepl } from "../chat/repl";
import { Message } from "../db/models";
import { withDb } from "../db/connection";
import { getNiaHome, getPaths } from "../utils/paths";
import { errMsg } from "../utils/errors";
import { fail } from "../utils/cli";
import { jobCommand } from "./job";
import { statusCommand } from "./status";
import { sendCommand, telegramCommand, slackCommand } from "./channels";
import { rulesCommand, memoryCommand } from "./self";

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
if (command && !["init", "help", "version", "-v", "--version"].includes(command)) {
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
    if (config.channels.slack.bot_token && config.channels.slack.app_token) expecting.add("slack");
  }
  expecting.add("scheduler");

  if (expecting.size === 0) return;

  const { readFileSync } = await import("fs");
  const ready = new Set<string>();
  let logOffset = 0;
  try { logOffset = readFileSync(daemonLog, "utf8").length; } catch {}

  const startTime = Date.now();
  while (ready.size < expecting.size && Date.now() - startTime < timeout) {
    await new Promise((r) => setTimeout(r, 500));
    let content = "";
    try { content = readFileSync(daemonLog, "utf8").slice(logOffset); } catch { continue; }

    for (const name of expecting) {
      if (ready.has(name)) continue;
      if (content.includes(STARTUP_MARKERS[name])) {
        ready.add(name);
        console.log(`  \u2713 ${name}`);
      }
    }
  }

  const pending = [...expecting].filter((e) => !ready.has(e));
  if (pending.length > 0) {
    console.log(`  \u26A0 timed out waiting for: ${pending.join(", ")}`);
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
    const { isServiceInstalled, restartService } = await import("../commands/service");
    if (isServiceInstalled()) {
      // Service-aware: unload (stops KeepAlive respawn), kill, then reload
      await restartService();
    } else {
      stopDaemon();
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
    if (prompt) {
      const { createChatEngine } = await import("../chat/engine");
      const { getMcpServers } = await import("../mcp");
      const DIM = "\x1b[2m";
      const RST = "\x1b[0m";
      const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
      let frame = 0;
      let statusText = "thinking";
      let spinTimer: ReturnType<typeof setInterval> | null = null;
      let streamedLen = 0;
      let streaming = false;

      const renderSpinner = () => {
        process.stderr.write(`\x1b[2K\r${DIM}  ${FRAMES[frame]} ${statusText}${RST}`);
        frame = (frame + 1) % FRAMES.length;
      };

      await withDb(async () => {
        const engine = await createChatEngine({ room: "cli-run", channel: "terminal", resume: false, mcpServers: getMcpServers() });
        spinTimer = setInterval(renderSpinner, 80);
        renderSpinner();

        const { result, costUsd, turns } = await engine.send(prompt, {
          onStream(textSoFar) {
            if (!streaming) {
              if (spinTimer) { clearInterval(spinTimer); spinTimer = null; }
              process.stderr.write("\x1b[2K\r");
              streaming = true;
            }
            const chunk = textSoFar.slice(streamedLen);
            if (chunk) { process.stdout.write(chunk); streamedLen = textSoFar.length; }
          },
          onActivity(text) {
            if (!streaming) statusText = text;
          },
        });

        if (spinTimer) { clearInterval(spinTimer); spinTimer = null; }

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
        const turnsStr = turns > 0 ? `${turns} turn${turns !== 1 ? "s" : ""}` : "";
        const meta = [costStr, turnsStr].filter(Boolean).join(" · ");
        if (meta) process.stderr.write(`\n${DIM}${meta}${RST}`);
        process.stdout.write("\n");

        engine.close();
      });
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
            const snippet = m.content.length > 120 ? m.content.slice(0, 120) + "..." : m.content;
            console.log(`  ${roomTag}${time}  ${prefix} > ${snippet.replace(/\n/g, " ")}`);
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
    const channelFilter = chIdx !== -1 && logArgs[chIdx + 1] ? logArgs[chIdx + 1] : null;

    if (channelFilter) {
      // Pipe through grep to filter by channel name in structured logs
      const tailArgs = follow ? ["tail", "-f", daemonLog] : ["tail", "-200", daemonLog];
      const tail = Bun.spawn(tailArgs, { stdio: ["ignore", "pipe", "inherit"] });
      const grep = Bun.spawn(["grep", "-i", channelFilter], { stdio: [tail.stdout, "inherit", "inherit"] });
      await grep.exited;
    } else {
      const args = follow ? ["tail", "-f", daemonLog] : ["tail", "-50", daemonLog];
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
    const mode = (chatArgs.includes("--new") || chatArgs.includes("-n"))
      ? "new" as const
      : (chatArgs.includes("--resume") || chatArgs.includes("-r"))
        ? "pick" as const
        : "continue" as const;
    const chIdx = chatArgs.indexOf("--channel");
    const simChannel = chIdx !== -1 && chatArgs[chIdx + 1] ? chatArgs[chIdx + 1] : undefined;
    await startRepl(mode, simChannel);
    break;
  }

  case "skills": {
    const { loadSkillNames } = await import("../chat/identity");
    const names = loadSkillNames();
    if (names.length === 0) {
      console.log("No skills found.");
    } else {
      for (const name of names) console.log(`  ${name}`);
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
        if (val && typeof val === "object") val = (val as Record<string, unknown>)[p];
        else { val = undefined; break; }
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
    if (sub === "on") {
      updateRawConfig({ channels: { enabled: true } });
      console.log("channels enabled — restart to apply");
    } else if (sub === "off") {
      updateRawConfig({ channels: { enabled: false } });
      console.log("channels disabled — restart to apply");
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
    const verbose = process.argv.includes("-v") || process.argv.includes("--verbose");
    const extraArgs = process.argv.slice(3).filter((a) => a !== "-v" && a !== "--verbose");
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
        if (/^\s*\d+ pass/.test(line) || /^\s*\d+ fail/.test(line) || /^Ran \d+ tests/.test(line) || /expect\(\) calls/.test(line)) {
          console.log(line);
        } else if (/^✗|FAIL|error:/i.test(line.trim())) {
          console.log(line);
        }
      }
    }
    process.exit(exitCode);
  }

  case "init": {
    const { runInit } = await import("../commands/init");
    await runInit();
    break;
  }

  default:
    console.log("Usage: nia <command>\n");
    console.log("  init                — setup nia");
    console.log("  start / stop        — daemon + service control");
    console.log("  restart             — restart daemon");
    console.log("  status [--json --rooms N --all]  — show daemon, jobs, channels");
    console.log("  health              — check daemon, db, channels, config");
    console.log("  chat [--channel ch] — interactive chat (--channel simulates a channel)");
    console.log("  run <prompt>        — one-shot execution");
    console.log("  history [room]      — recent messages");
    console.log("  logs [-f] [--channel ch]  — daemon logs (filter by channel)");
    console.log("  job <sub>           — manage jobs");
    console.log("  rules [show|reset]  — view or reset rules.md");
    console.log("  memory [show|reset] — view or reset memory.md");
    console.log("  db <sub>            — database setup/status/migrate");
    console.log("  skills              — list available skills");
    console.log("  config <sub>        — get/set/list config values");
    console.log("  send [-c ch] <msg>  — send a message via channel");
    console.log("  telegram <token>    — configure telegram");
    console.log("  slack <bot> <app>   — configure slack");
    console.log("  test                — run tests");
    process.exit(command ? 1 : 0);
}
