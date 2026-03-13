#!/usr/bin/env bun
import { existsSync, mkdirSync } from "fs";
import { isRunning, readPid, runDaemon, startDaemon, stopDaemon } from "../core/daemon";
import { readState } from "../utils/logger";
import { getConfig, updateRawConfig } from "../utils/config";
import { localTime } from "../utils/time";
import { startRepl } from "../chat/repl";
import { Message, ActiveEngine, Job, Session } from "../db/models";
import { withDb } from "../db/connection";
import { getNiaHome, getPaths } from "../utils/paths";
import { errMsg } from "../utils/errors";
import { fail } from "./helpers";
import { jobCommand } from "./job";

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
    const running = isRunning();
    const pid = readPid();
    console.log(`nia: ${running ? `running (pid: ${pid})` : "stopped"}`);

    const config = getConfig();
    if (config.telegram_bot_token) {
      const masked = `...${config.telegram_bot_token.slice(-6)}`;
      console.log(`telegram: ${running ? `active (${masked})` : `configured (${masked}, daemon stopped)`}`);
    } else {
      console.log("telegram: not configured");
    }

    try {
      await withDb(async () => {
        const jobs = await Job.list();
        if (jobs.length > 0) {
          console.log("\nJobs:");
          const state = readState();
          for (const job of jobs) {
            const info = state[job.name];
            const status = info ? `${info.status} (last: ${localTime(new Date(info.lastRun))}, ${info.duration_ms}ms)` : "never run";
            console.log(`  ${job.name}: ${job.enabled ? "enabled" : "disabled"} [${job.schedule}] — ${status}`);
          }
        }

        const engines = await ActiveEngine.list();
        console.log(`\nActive engines: ${engines.length === 0 ? "none" : ""}`);
        for (const e of engines) {
          console.log(`  ${e.room} (${e.channel}) since ${localTime(new Date(e.startedAt))}`);
        }

        const rooms = await Message.getRoomStats();
        if (rooms.length > 0) {
          console.log("\nChat rooms:");
          for (const r of rooms) {
            const last = r.lastActivity ? localTime(new Date(r.lastActivity)) : "never";
            console.log(`  ${r.room}: ${r.messages} msgs, ${r.sessions} session${r.sessions !== 1 ? "s" : ""} (last: ${last})`);
          }
        }
      });
    } catch {
      const state = readState();
      const entries = Object.entries(state);
      if (entries.length > 0) {
        console.log("\nJobs (from state file):");
        for (const [name, info] of entries) {
          console.log(`  ${name}: ${info.status} (last: ${localTime(new Date(info.lastRun))}, ${info.duration_ms}ms)`);
        }
      }
    }
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
    const message = process.argv.slice(3).join(" ");
    if (!message) fail("Usage: nia send <message>");

    const { sendMessage } = await import("../mcp/tools");

    try {
      await withDb(async () => {
        const result = await sendMessage(message);
        console.log(result);
      });
    } catch (err) {
      fail(`Failed to send: ${errMsg(err)}`);
    }
    break;
  }

  case "telegram": {
    const token = process.argv[3];
    const chatId = process.argv[4];

    if (!token) {
      const config = getConfig();
      if (config.telegram_bot_token) {
        console.log(`Telegram: configured (...${config.telegram_bot_token.slice(-6)})`);
      } else {
        console.log("Telegram: not configured");
      }
      console.log("\nUsage: nia telegram <bot-token> [chat-id]");
      break;
    }

    const fields: Record<string, unknown> = { telegram_bot_token: token };
    if (chatId) fields.telegram_chat_id = Number(chatId);
    updateRawConfig(fields);

    console.log(`Telegram bot token saved to ${getPaths().config}`);
    if (chatId) console.log(`Chat ID: ${chatId}`);
    console.log("Run `nia restart` to activate.");
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
    console.log("  send <message>      — send a message via telegram");
    console.log("  telegram <token>    — configure telegram");
    console.log("  test                — run tests");
    process.exit(command ? 1 : 0);
}
