#!/usr/bin/env bun
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { isRunning, readPid, runDaemon, startDaemon, stopDaemon } from "./core/daemon";
import { readState } from "./utils/logger";
import { parseJobs } from "./core/cron";
import { getConfig, resetConfig } from "./utils/config";
import { runJob } from "./core/runner";
import { localTime } from "./utils/time";
import { startRepl } from "./chat/repl";
import { runMigrations } from "./db/migrate";
import { Message, ActiveEngine, Job } from "./db/models";
import { closeDb } from "./db/connection";
import { getNiaHome, getPaths } from "./utils/paths";
import cron from "node-cron";
import yaml from "js-yaml";

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
  const home = getNiaHome();
  mkdirSync(home, { recursive: true });
}

switch (command) {
  case "start": {
    const useService = process.argv[3] === "--service";
    if (useService) {
      const { installService } = await import("./commands/service");
      await installService();
    } else {
      if (isRunning()) {
        const pid = readPid();
        console.log(`nia is already running (pid: ${pid})`);
        process.exit(1);
      }
      const pid = startDaemon();
      console.log(`nia started (pid: ${pid})`);
    }
    break;
  }

  case "stop": {
    const useService = process.argv[3] === "--service";
    if (useService) {
      const { uninstallService } = await import("./commands/service");
      await uninstallService();
    } else {
      if (!isRunning()) {
        console.log("nia is not running");
        process.exit(1);
      }
      stopDaemon();
      console.log("nia stopped");
    }
    break;
  }

  case "status": {
    const running = isRunning();
    const pid = readPid();
    console.log(`nia: ${running ? `running (pid: ${pid})` : "stopped"}`);

    // Telegram status
    const config = getConfig();
    let telegramStatus = "not configured";
    if (config.telegram_bot_token) {
      const masked = `...${config.telegram_bot_token.slice(-6)}`;
      telegramStatus = running ? `active (${masked})` : `configured (${masked}, daemon stopped)`;
    }
    console.log(`telegram: ${telegramStatus}`);

    // Jobs from DB
    try {
      await runMigrations();

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

      // Active engines
      const engines = await ActiveEngine.list();
      console.log(`\nActive engines: ${engines.length === 0 ? "none" : ""}`);
      for (const e of engines) {
        const since = localTime(new Date(e.startedAt));
        console.log(`  ${e.room} (${e.channel}) since ${since}`);
      }

      // Chat rooms
      const rooms = await Message.getRoomStats();
      if (rooms.length > 0) {
        console.log("\nChat rooms:");
        for (const r of rooms) {
          const last = r.lastActivity ? localTime(new Date(r.lastActivity)) : "never";
          console.log(`  ${r.room}: ${r.messages} msgs, ${r.sessions} session${r.sessions !== 1 ? "s" : ""} (last: ${last})`);
        }
      }
      await closeDb();
    } catch {
      // postgres not available — show file-based job state
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
    if (isRunning()) {
      stopDaemon();
    }
    const newPid = startDaemon();
    console.log(`nia restarted (pid: ${newPid})`);
    break;
  }

  case "reload": {
    const pid = readPid();
    if (!pid || !isRunning()) {
      console.log("nia is not running");
      process.exit(1);
    }
    try {
      process.kill(pid, "SIGHUP");
      console.log("reload signal sent");
    } catch {
      console.log("failed to send reload signal");
      process.exit(1);
    }
    break;
  }

  case "run": {
    // No args = foreground daemon mode (used by daemon's child process)
    // With args = one-shot prompt execution
    const prompt = process.argv.slice(3).join(" ");
    if (prompt) {
      const { createChatEngine } = await import("./chat/engine");
      await runMigrations();
      const engine = await createChatEngine({ room: "cli-run", channel: "terminal", resume: false });
      const { result } = await engine.send(prompt);
      console.log(result.trim());
      engine.close();
      await closeDb();
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
          await runMigrations();
          const jobs = await Job.list();
          if (jobs.length === 0) {
            console.log("No jobs configured. Use `nia job add` or `nia job import`.");
          } else {
            for (const job of jobs) {
              console.log(`  ${job.enabled ? "●" : "○"} ${job.name}  ${job.schedule}  ${job.prompt.slice(0, 60)}${job.prompt.length > 60 ? "..." : ""}`);
            }
          }
          await closeDb();
        } catch (err) {
          console.log(`Failed to list jobs: ${err instanceof Error ? err.message : String(err)}`);
          process.exit(1);
        }
        break;
      }

      case "add": {
        const name = process.argv[4];
        const schedule = process.argv[5];
        const prompt = process.argv.slice(6).join(" ");

        if (!name || !schedule || !prompt) {
          console.log('Usage: nia job add <name> <schedule> <prompt>');
          console.log('Example: nia job add heartbeat "*/10 * * * *" Check system health');
          process.exit(1);
        }

        if (!cron.validate(schedule)) {
          console.log(`Invalid cron schedule: ${schedule}`);
          process.exit(1);
        }

        try {
          await runMigrations();
          await Job.create(name, schedule, prompt);
          console.log(`Job "${name}" added. Run \`nia reload\` to activate.`);
          await closeDb();
        } catch (err) {
          console.log(`Failed to add job: ${err instanceof Error ? err.message : String(err)}`);
          process.exit(1);
        }
        break;
      }

      case "remove": {
        const name = process.argv[4];
        if (!name) {
          console.log("Usage: nia job remove <name>");
          process.exit(1);
        }

        try {
          await runMigrations();
          const removed = await Job.remove(name);
          if (removed) {
            console.log(`Job "${name}" removed. Run \`nia reload\` to apply.`);
          } else {
            console.log(`Job not found: ${name}`);
          }
          await closeDb();
        } catch (err) {
          console.log(`Failed to remove job: ${err instanceof Error ? err.message : String(err)}`);
          process.exit(1);
        }
        break;
      }

      case "enable": {
        const name = process.argv[4];
        if (!name) {
          console.log("Usage: nia job enable <name>");
          process.exit(1);
        }

        try {
          await runMigrations();
          const updated = await Job.update(name, { enabled: true });
          if (updated) {
            console.log(`Job "${name}" enabled. Run \`nia reload\` to apply.`);
          } else {
            console.log(`Job not found: ${name}`);
          }
          await closeDb();
        } catch (err) {
          console.log(`Failed: ${err instanceof Error ? err.message : String(err)}`);
          process.exit(1);
        }
        break;
      }

      case "disable": {
        const name = process.argv[4];
        if (!name) {
          console.log("Usage: nia job disable <name>");
          process.exit(1);
        }

        try {
          await runMigrations();
          const updated = await Job.update(name, { enabled: false });
          if (updated) {
            console.log(`Job "${name}" disabled. Run \`nia reload\` to apply.`);
          } else {
            console.log(`Job not found: ${name}`);
          }
          await closeDb();
        } catch (err) {
          console.log(`Failed: ${err instanceof Error ? err.message : String(err)}`);
          process.exit(1);
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
          await runMigrations();
          let imported = 0;
          let skipped = 0;
          for (const job of yamlJobs) {
            const existing = await Job.get(job.name);
            if (existing) {
              skipped++;
              continue;
            }
            await Job.create(job.name, job.schedule, job.prompt);
            if (!job.enabled) {
              await Job.update(job.name, { enabled: false });
            }
            imported++;
          }
          console.log(`Imported ${imported} job${imported !== 1 ? "s" : ""}${skipped > 0 ? ` (${skipped} already exist)` : ""}`);
          if (imported > 0) {
            console.log("Run `nia reload` to activate.");
          }
          await closeDb();
        } catch (err) {
          console.log(`Failed to import: ${err instanceof Error ? err.message : String(err)}`);
          process.exit(1);
        }
        break;
      }

      case "run": {
        const name = process.argv[4];
        if (!name) {
          console.log("Usage: nia job run <name>");
          process.exit(1);
        }

        let job: { name: string; schedule: string; prompt: string } | null = null;

        // Try DB first
        try {
          await runMigrations();
          job = await Job.get(name);
        } catch {
          // DB unavailable
        }

        // Fall back to YAML
        if (!job) {
          const yamlJobs = parseJobs();
          const found = yamlJobs.find((j) => j.name === name);
          if (found) job = found;
        }

        if (!job) {
          console.log(`Job not found: ${name}`);
          process.exit(1);
        }

        const config = getConfig();
        console.log(`Running job: ${job.name} (model: ${config.model})`);
        const result = await runJob(job);
        console.log(`\nStatus: ${result.status}`);
        console.log(`Duration: ${result.duration_ms}ms`);
        if (result.result) console.log(`\nResult:\n${result.result}`);
        if (result.error) console.log(`\nError: ${result.error}`);
        try { await closeDb(); } catch {}
        break;
      }

      default: {
        console.log("Usage: nia job <list|add|remove|enable|disable|run|import>");
        console.log("");
        console.log("  list                          — list all jobs");
        console.log("  add <name> <schedule> <prompt> — add a new job");
        console.log("  remove <name>                 — delete a job");
        console.log("  enable <name>                 — enable a job");
        console.log("  disable <name>                — disable a job");
        console.log("  run <name>                    — run a job once");
        console.log("  import                        — import YAML jobs to DB");
        process.exit(subcommand ? 1 : 0);
      }
    }
    break;
  }

  case "history": {
    const room = process.argv[3]; // optional room filter
    try {
      await runMigrations();
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
      await closeDb();
    } catch (err) {
      console.log(`Failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
    break;
  }

  case "logs": {
    const { daemonLog } = getPaths();
    if (!existsSync(daemonLog)) {
      console.log("No daemon log found. Is nia running?");
      process.exit(1);
    }
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
    const paths = getPaths();

    if (!token) {
      const config = getConfig();
      if (config.telegram_bot_token) {
        const masked = `...${config.telegram_bot_token.slice(-6)}`;
        console.log(`Telegram: configured (${masked})`);
      } else {
        console.log("Telegram: not configured");
      }
      console.log("\nUsage: nia telegram <bot-token> [chat-id]");
      break;
    }

    // Read existing config.yaml, update telegram fields, write back
    let raw: Record<string, unknown> = {};
    if (existsSync(paths.config)) {
      try {
        const parsed = yaml.load(readFileSync(paths.config, "utf8"));
        if (parsed && typeof parsed === "object") {
          raw = parsed as Record<string, unknown>;
        }
      } catch {
        // corrupt config — start fresh
      }
    }

    raw.telegram_bot_token = token;
    if (chatId) {
      raw.telegram_chat_id = Number(chatId);
    }

    mkdirSync(getNiaHome(), { recursive: true });
    writeFileSync(paths.config, yaml.dump(raw, { lineWidth: -1 }));
    resetConfig();

    console.log("Telegram bot token saved to ~/.niahere/config.yaml");
    if (chatId) console.log(`Chat ID: ${chatId}`);
    console.log("Run `nia restart` to activate.");
    break;
  }

  case "init": {
    const { runInit } = await import("./commands/init");
    await runInit();
    break;
  }

  default:
    console.log("Usage: nia <command>\n");
    console.log("  init                — setup nia");
    console.log("  start / stop        — daemon control");
    console.log("  status              — show daemon, jobs, channels");
    console.log("  chat [-r|--resume]  — interactive chat");
    console.log("  run <prompt>        — one-shot execution");
    console.log("  history [room]      — recent messages");
    console.log("  logs [-f]           — daemon logs");
    console.log("  job <sub>           — manage jobs");
    console.log("  skills              — list available skills");
    console.log("  telegram <token>    — configure telegram");
    process.exit(command ? 1 : 0);
}
