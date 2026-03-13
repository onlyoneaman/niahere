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
import { fail } from "./helpers";
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
    await registerService();
    console.log(`nia started (pid: ${startDaemon()})`);
    break;
  }

  case "stop": {
    if (!isRunning()) fail("nia is not running");
    stopDaemon();
    const { unregisterService } = await import("../commands/service");
    await unregisterService();
    console.log("nia stopped");
    break;
  }

  case "status": {
    await statusCommand();
    break;
  }

  case "restart": {
    if (isRunning()) stopDaemon();
    console.log(`nia restarted (pid: ${startDaemon()})`);
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
    slackCommand();
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
    console.log("  status              — show daemon, jobs, channels");
    console.log("  chat [-r|--resume]  — interactive chat");
    console.log("  run <prompt>        — one-shot execution");
    console.log("  history [room]      — recent messages");
    console.log("  logs [-f]           — daemon logs");
    console.log("  job <sub>           — manage jobs");
    console.log("  skills              — list available skills");
    console.log("  send [-c ch] <msg>  — send a message via channel");
    console.log("  telegram <token>    — configure telegram");
    console.log("  slack <bot> <app>   — configure slack");
    console.log("  test                — run tests");
    process.exit(command ? 1 : 0);
}
