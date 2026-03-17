import * as readline from "readline";
import { createChatEngine } from "./engine";
import { runMigrations } from "../db/migrate";
import { closeDb } from "../db/connection";
import { getMcpServers, setMcpServers } from "../mcp";
import { createNiaMcpServer } from "../mcp/server";
import { Session } from "../db/models";
import { relativeTime } from "../utils/format";

// ANSI helpers
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const CYAN = "\x1b[36m";
const RESET = "\x1b[0m";
const CLEAR_LINE = "\x1b[2K\r";

// Braille spinner frames
const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

class StatusLine {
  private frame = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private text = "";
  private active = false;

  start(initialText = "thinking") {
    this.text = initialText;
    this.active = true;
    this.frame = 0;
    this.render();
    this.timer = setInterval(() => {
      this.frame = (this.frame + 1) % SPINNER.length;
      this.render();
    }, 80);
  }

  update(text: string) {
    this.text = text;
    if (this.active) this.render();
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.active) {
      process.stderr.write(CLEAR_LINE);
    }
    this.active = false;
  }

  private render() {
    const spinner = SPINNER[this.frame];
    process.stderr.write(`${CLEAR_LINE}${DIM}  ${spinner} ${this.text}${RESET}`);
  }
}

function truncatePreview(text: string, max: number): string {
  const oneline = text.replace(/\n/g, " ").trim();
  return oneline.length > max ? oneline.slice(0, max) + "…" : oneline;
}

async function pickSession(): Promise<string | null> {
  const sessions = await Session.getRecent("terminal", 10);
  if (sessions.length === 0) {
    console.log(`${DIM}no previous sessions${RESET}\n`);
    return null;
  }

  const now = new Date();
  console.log(`\n${DIM}recent sessions:${RESET}\n`);

  for (let i = 0; i < sessions.length; i++) {
    const s = sessions[i];
    const age = relativeTime(new Date(s.updatedAt), now);
    const preview = s.preview ? truncatePreview(s.preview, 50) : "empty session";
    const msgs = `${s.messageCount} msg${s.messageCount !== 1 ? "s" : ""}`;
    console.log(`  ${BOLD}${i + 1}${RESET}  ${preview}  ${DIM}${msgs} · ${age}${RESET}`);
  }

  console.log(`\n  ${DIM}n${RESET}  start new session`);
  console.log();

  return new Promise<string | null>((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question(`${DIM}select [1-${sessions.length}, n]:${RESET} `, (answer) => {
      rl.close();
      const trimmed = answer.trim().toLowerCase();

      if (trimmed === "n" || trimmed === "new") {
        resolve(null);
        return;
      }

      const idx = parseInt(trimmed, 10);
      if (idx >= 1 && idx <= sessions.length) {
        resolve(sessions[idx - 1].id);
      } else if (trimmed === "" && sessions.length > 0) {
        // Default: most recent session
        resolve(sessions[0].id);
      } else {
        resolve(null);
      }
    });
  });
}

export type ChatMode = "continue" | "new" | "pick";

export async function startRepl(mode: ChatMode = "continue"): Promise<void> {
  try {
    await runMigrations();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Failed to connect to postgres: ${msg}`);
    console.error(`Set database_url in ~/.niahere/config.yaml or run \`nia init\``);
    process.exit(1);
  }

  // Initialize MCP server if not already set (standalone chat mode)
  if (!getMcpServers()) {
    try {
      const mcpConfig = createNiaMcpServer();
      setMcpServers({ nia: mcpConfig });
    } catch {}
  }

  // Determine session to use
  let resume: boolean | string = false;

  if (mode === "pick") {
    const picked = await pickSession();
    if (picked) {
      resume = picked;
    }
  } else if (mode === "continue") {
    resume = true;
  }

  const engine = await createChatEngine({ room: "terminal", channel: "terminal", resume, mcpServers: getMcpServers() });

  // Welcome
  const isResumed = engine.sessionId && resume;
  const sessionNote = isResumed ? "resumed" : "new session";
  console.log(`\n${DIM}nia chat${RESET} ${DIM}(${sessionNote})${RESET}`);
  console.log(`${DIM}type /exit to quit${RESET}\n`);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: `${BOLD}>${RESET} `,
  });

  rl.prompt();

  rl.on("line", async (line: string) => {
    const input = line.trim();

    if (!input) {
      rl.prompt();
      return;
    }

    const exitCommands = ["/exit", "/quit", ".exit", ".quit", "exit", "quit"];
    if (exitCommands.includes(input.toLowerCase())) {
      rl.close();
      return;
    }

    const status = new StatusLine();
    status.start("thinking");

    let streamedLength = 0;
    let responseStarted = false;

    try {
      const { result, costUsd, turns } = await engine.send(input, {
        onStream(textSoFar) {
          // Stream response text as it arrives
          if (!responseStarted) {
            status.stop();
            process.stdout.write("\n");
            responseStarted = true;
          }
          const newText = textSoFar.slice(streamedLength);
          if (newText) {
            process.stdout.write(newText);
            streamedLength = textSoFar.length;
          }
        },
        onActivity(activityText) {
          if (!responseStarted) {
            status.update(activityText);
          }
        },
      });

      // If streaming didn't fire (e.g. tool-only turns), print the result
      if (!responseStarted && result.trim()) {
        status.stop();
        process.stdout.write(`\n${result.trim()}`);
      } else if (responseStarted) {
        // Print any remaining text that wasn't streamed
        const remaining = result.slice(streamedLength);
        if (remaining.trim()) {
          process.stdout.write(remaining);
        }
      } else {
        status.stop();
      }

      // Cost line
      const costStr = costUsd > 0 ? `$${costUsd.toFixed(4)}` : "";
      const turnsStr = turns > 0 ? `${turns} turn${turns !== 1 ? "s" : ""}` : "";
      const meta = [costStr, turnsStr].filter(Boolean).join(" · ");
      if (meta) {
        process.stdout.write(`\n${DIM}${meta}${RESET}`);
      }

      process.stdout.write("\n\n");
    } catch (err) {
      status.stop();
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`\n${DIM}error:${RESET} ${msg}\n`);
    }

    rl.prompt();
  });

  rl.on("close", async () => {
    console.log(`\n${DIM}bye${RESET}`);
    engine.close();
    await closeDb();
    process.exit(0);
  });

  process.on("SIGINT", () => {
    rl.close();
  });
}
