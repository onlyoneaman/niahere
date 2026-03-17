import * as readline from "readline";
import { createChatEngine } from "./engine";
import { runMigrations } from "../db/migrate";
import { closeDb } from "../db/connection";
import { getMcpServers, setMcpServers } from "../mcp";
import { createNiaMcpServer } from "../mcp/server";

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

export async function startRepl(resume = false): Promise<void> {
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

  const engine = await createChatEngine({ room: "terminal", channel: "terminal", resume, mcpServers: getMcpServers() });

  // Welcome
  const sessionNote = resume && engine.sessionId ? "resumed session" : "new session";
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
