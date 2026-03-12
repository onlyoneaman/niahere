#!/usr/bin/env bun
import { resolve } from "path";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { isRunning, readPid, runDaemon, startDaemon, stopDaemon } from "./core/daemon";
import { readState } from "./utils/logger";
import { parseJobs } from "./core/cron";
import { loadConfig } from "./utils/config";
import { runJob } from "./core/runner";
import { localTime } from "./utils/time";
import { startRepl } from "./chat/repl";
import { runMigrations } from "./db/migrate";
import { Message, ActiveEngine, Job } from "./db/models";
import { closeDb } from "./db/connection";
import cron from "node-cron";

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

    // Telegram status
    const envPath = resolve(workspace, ".env");
    let telegramStatus = "not configured";
    if (existsSync(envPath)) {
      const env = readFileSync(envPath, "utf8");
      const tokenLine = env.split("\n").find((l) => l.startsWith("TELEGRAM_BOT_TOKEN="));
      if (tokenLine) {
        const token = tokenLine.split("=")[1]?.trim();
        const masked = token ? `...${token.slice(-6)}` : "";
        telegramStatus = running ? `active (${masked})` : `configured (${masked}, daemon stopped)`;
      }
    }
    console.log(`telegram: ${telegramStatus}`);

    // Jobs from DB
    try {
      await runMigrations();

      const jobs = await Job.list();
      if (jobs.length > 0) {
        console.log("\nJobs:");
        const state = readState(workspace);
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
      const state = readState(workspace);
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
    if (isRunning(workspace)) {
      stopDaemon(workspace);
    }
    const newPid = startDaemon(workspace);
    console.log(`nia restarted (pid: ${newPid})`);
    break;
  }

  case "reload": {
    const pid = readPid(workspace);
    if (!pid || !isRunning(workspace)) {
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
    // Foreground mode — used by daemon's child process
    await runDaemon(workspace);
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
        const yamlJobs = parseJobs(workspace);
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
          const yamlJobs = parseJobs(workspace);
          const found = yamlJobs.find((j) => j.name === name);
          if (found) job = found;
        }

        if (!job) {
          console.log(`Job not found: ${name}`);
          process.exit(1);
        }

        const config = loadConfig(workspace);
        console.log(`Running job: ${job.name} (model: ${config.model})`);
        const result = await runJob(workspace, job, config.model);
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

  case "seed": {
    await import("./db/seed");
    break;
  }

  case "chat": {
    await startRepl(workspace);
    break;
  }

  case "telegram": {
    const token = process.argv[3];
    const envPath = resolve(workspace, ".env");

    if (!token) {
      if (existsSync(envPath)) {
        const env = readFileSync(envPath, "utf8");
        const hasToken = env.split("\n").some((l) => l.startsWith("TELEGRAM_BOT_TOKEN="));
        console.log(hasToken ? "Telegram: configured" : "Telegram: not configured");
      } else {
        console.log("Telegram: not configured");
      }
      console.log("\nUsage: nia telegram <bot-token>");
      break;
    }

    let lines: string[] = [];
    if (existsSync(envPath)) {
      lines = readFileSync(envPath, "utf8").split("\n");
    }

    const idx = lines.findIndex((l) => l.startsWith("TELEGRAM_BOT_TOKEN="));
    const entry = `TELEGRAM_BOT_TOKEN=${token}`;
    if (idx >= 0) {
      lines[idx] = entry;
    } else {
      lines.push(entry);
    }

    writeFileSync(envPath, lines.filter((l) => l !== "").join("\n") + "\n");
    console.log("Telegram bot token saved to .env");
    console.log("Run `nia restart` to activate.");
    break;
  }

  default:
    console.log("Usage: nia <start|stop|restart|reload|status|seed|job|chat|telegram>");
    process.exit(1);
}
