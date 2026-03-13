import * as readline from "readline";
import { createChatEngine } from "./engine";
import { runMigrations } from "../db/migrate";
import { closeDb } from "../db/connection";
import { getMcpServers } from "../mcp";

export async function startRepl(resume = false): Promise<void> {
  try {
    await runMigrations();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Failed to connect to postgres: ${msg}`);
    console.error(`Set database_url in ~/.niahere/config.yaml or run \`nia init\``);
    process.exit(1);
  }

  const engine = await createChatEngine({ room: "terminal", channel: "terminal", resume, mcpServers: getMcpServers() });

  console.log(resume && engine.sessionId ? "Resumed previous session." : "New chat session started.");
  console.log('Type your message and press Enter. Type "exit" or Ctrl+C to quit.\n');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "you > ",
  });

  rl.prompt();

  rl.on("line", async (line: string) => {
    const input = line.trim();

    if (!input) {
      rl.prompt();
      return;
    }

    const exitCommands = [".exit", ".quit", "exit", "quit"];
    if (exitCommands.includes(input.toLowerCase())) {
      rl.close();
      return;
    }

    process.stdout.write("\n");

    try {
      const { result, costUsd, turns } = await engine.send(input, {
        onActivity(status) {
          process.stdout.write(`\x1b[2m  ${status}\x1b[0m\n`);
        },
      });
      console.log(`nia > ${result.trim()}\n`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[error] ${msg}\n`);
    }

    rl.prompt();
  });

  rl.on("close", async () => {
    console.log("\nBye!");
    engine.close();
    await closeDb();
    process.exit(0);
  });

  process.on("SIGINT", () => {
    rl.close();
  });
}
