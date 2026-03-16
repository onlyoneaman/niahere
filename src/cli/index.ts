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
      await withDb(async () => {
        const engine = await createChatEngine({ room: "cli-run", channel: "terminal", resume: false, mcpServers: getMcpServers() });
        const { result } = await engine.send(prompt);
        console.log(result.trim());
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
    const follow = process.argv[3] === "-f" || process.argv[3] === "--follow";
    const args = follow ? ["tail", "-f", daemonLog] : ["tail", "-50", daemonLog];
    const proc = Bun.spawn(args, { stdio: ["ignore", "inherit", "inherit"] });
    await proc.exited;
    break;
  }

  case "seed": {
    await import("../db/seed");
    break;
  }

  case "chat": {
    const resume = process.argv[3] === "--resume" || process.argv[3] === "-r";
    await startRepl(resume);
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
    console.log("  chat [-r|--resume]  — interactive chat");
    console.log("  run <prompt>        — one-shot execution");
    console.log("  history [room]      — recent messages");
    console.log("  logs [-f]           — daemon logs");
    console.log("  job <sub>           — manage jobs");
    console.log("  db <sub>            — database setup/status/migrate");
    console.log("  skills              — list available skills");
    console.log("  send [-c ch] <msg>  — send a message via channel");
    console.log("  telegram <token>    — configure telegram");
    console.log("  slack <bot> <app>   — configure slack");
    console.log("  test                — run tests");
    process.exit(command ? 1 : 0);
}
