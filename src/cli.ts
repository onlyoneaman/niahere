#!/usr/bin/env bun
import { existsSync, mkdirSync } from "fs";
import { isRunning, readPid, runDaemon, startDaemon, stopDaemon } from "./core/daemon";
import { readState } from "./utils/logger";
import { parseJobs } from "./core/cron";
import { getConfig, updateRawConfig } from "./utils/config";
import { runJob } from "./core/runner";
import { localTime } from "./utils/time";
import { startRepl } from "./chat/repl";
import { Message, ActiveEngine, Job } from "./db/models";
import { withDb } from "./db/connection";
import { getNiaHome, getPaths } from "./utils/paths";
import { errMsg } from "./utils/errors";
import cron from "node-cron";

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
if (command && command !== "init" && command !== "help") {
  mkdirSync(getNiaHome(), { recursive: true });
}

/** Print error and exit. */
function fail(msg: string): never {
  console.log(msg);
  process.exit(1);
}

switch (command) {
  case "start": {
    if (isRunning()) fail(`nia is already running (pid: ${readPid()})`);
    const { registerService } = await import("./commands/service");
    await registerService();
    console.log(`nia started (pid: ${startDaemon()})`);
    break;
  }

  case "stop": {
    if (!isRunning()) fail("nia is not running");
    stopDaemon();
    const { unregisterService } = await import("./commands/service");
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
    // No args = foreground daemon mode (used by daemon's child process)
    // With args = one-shot prompt execution
    const prompt = process.argv.slice(3).join(" ");
    if (prompt) {
      const { createChatEngine } = await import("./chat/engine");
      await withDb(async () => {
        const engine = await createChatEngine({ room: "cli-run", channel: "terminal", resume: false });
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
                console.log(`  ${job.enabled ? "●" : "○"} ${job.name}  ${job.schedule}  ${job.prompt.slice(0, 60)}${job.prompt.length > 60 ? "..." : ""}`);
              }
            }
          });
        } catch (err) {
          fail(`Failed to list jobs: ${errMsg(err)}`);
        }
        break;
      }

      case "add": {
        const name = process.argv[4];
        const schedule = process.argv[5];
        const prompt = process.argv.slice(6).join(" ");

        if (!name || !schedule || !prompt) {
          console.log('Usage: nia job add <name> <schedule> <prompt>');
          fail('Example: nia job add heartbeat "*/10 * * * *" Check system health');
        }
        if (!cron.validate(schedule)) fail(`Invalid cron schedule: ${schedule}`);

        try {
          await withDb(async () => {
            await Job.create(name, schedule, prompt);
            console.log(`Job "${name}" added.`);
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

      case "import": {
        const yamlJobs = parseJobs();
        if (yamlJobs.length === 0) {
          console.log("No YAML job files found in jobs/");
          break;
        }

        try {
          await withDb(async () => {
            let imported = 0;
            let skipped = 0;
            for (const job of yamlJobs) {
              if (await Job.get(job.name)) { skipped++; continue; }
              await Job.create(job.name, job.schedule, job.prompt);
              if (!job.enabled) await Job.update(job.name, { enabled: false });
              imported++;
            }
            console.log(`Imported ${imported} job${imported !== 1 ? "s" : ""}${skipped > 0 ? ` (${skipped} already exist)` : ""}`);
            if (imported > 0) console.log("Jobs will be picked up automatically.");
          });
        } catch (err) {
          fail(`Failed to import: ${errMsg(err)}`);
        }
        break;
      }

      case "status": {
        const name = process.argv[4];
        if (!name) fail("Usage: nia job status <name>");

        try {
          await withDb(async () => {
            const job = await Job.get(name);
            if (!job) fail(`Job not found: ${name}`);

            console.log(`  ${job.enabled ? "●" : "○"} ${job.name}`);
            console.log(`  schedule: ${job.schedule}`);
            console.log(`  enabled:  ${job.enabled}`);
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
          });
        } catch (err) {
          fail(`Failed: ${errMsg(err)}`);
        }
        break;
      }

      case "run": {
        const name = process.argv[4];
        if (!name) fail("Usage: nia job run <name>");

        let job: { name: string; schedule: string; prompt: string } | null = null;
        try {
          await withDb(async () => { job = await Job.get(name); });
        } catch { /* DB unavailable */ }

        if (!job) {
          const found = parseJobs().find((j) => j.name === name);
          if (found) job = found;
        }
        if (!job) fail(`Job not found: ${name}`);

        console.log(`Running job: ${job.name} (model: ${getConfig().model})`);
        const result = await runJob(job);
        console.log(`\nStatus: ${result.status}`);
        console.log(`Duration: ${result.duration_ms}ms`);
        if (result.result) console.log(`\nResult:\n${result.result}`);
        if (result.error) console.log(`\nError: ${result.error}`);
        break;
      }

      default:
        console.log("Usage: nia job <list|add|remove|enable|disable|status|run|import>\n");
        console.log("  list                          — list all jobs");
        console.log("  add <name> <schedule> <prompt> — add a new job");
        console.log("  remove <name>                 — delete a job");
        console.log("  enable <name>                 — enable a job");
        console.log("  disable <name>                — disable a job");
        console.log("  status <name>                 — show job details + last run");
        console.log("  run <name>                    — run a job once");
        console.log("  import                        — import YAML jobs to DB");
        process.exit(subcommand ? 1 : 0);
    }
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
    await import("./db/seed");
    break;
  }

  case "chat": {
    const resume = process.argv[3] === "--resume" || process.argv[3] === "-r";
    await startRepl(resume);
    break;
  }

  case "skills": {
    const { loadSkillNames } = await import("./chat/identity");
    const names = loadSkillNames();
    if (names.length === 0) {
      console.log("No skills found.");
    } else {
      for (const name of names) console.log(`  ${name}`);
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
    const proc = Bun.spawn(["bun", "test", ...process.argv.slice(3)], {
      stdio: ["ignore", "inherit", "inherit"],
      cwd: import.meta.dir + "/..",
    });
    process.exit(await proc.exited);
  }

  case "init": {
    const { runInit } = await import("./commands/init");
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
    console.log("  telegram <token>    — configure telegram");
    console.log("  test                — run tests");
    process.exit(command ? 1 : 0);
}
