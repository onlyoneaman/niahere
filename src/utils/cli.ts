import * as readline from "readline";

// TTY detection — disable colors/formatting when piped
const isTTY = process.stdout.isTTY ?? false;

// ANSI colors (empty strings when not a TTY)
export const DIM = isTTY ? "\x1b[2m" : "";
export const BOLD = isTTY ? "\x1b[1m" : "";
export const RESET = isTTY ? "\x1b[0m" : "";
export const RED = isTTY ? "\x1b[31m" : "";
export const GREEN = isTTY ? "\x1b[32m" : "";
export const YELLOW = isTTY ? "\x1b[33m" : "";
export const CYAN = isTTY ? "\x1b[36m" : "";
export const CLEAR_LINE = isTTY ? "\x1b[2K\r" : "";

// Icons
export const ICON_PASS = "\u2713";
export const ICON_FAIL = "\u2717";
export const ICON_WARN = "\u26A0";
export const ICON_RUNNING = "\u21bb";

// Spinner frames
export const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/** Print error to stderr and exit with code 1. */
export function fail(msg: string): never {
  console.error(msg);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Argument parser
// ---------------------------------------------------------------------------

export interface ParsedArgs {
  /** Positional arguments (everything that isn't a flag or flag value). */
  positional: string[];
  /** Named flags: --foo bar → { foo: "bar" }, --flag → { flag: true }, --no-flag → { flag: false }. */
  flags: Record<string, string | boolean>;
  /** Returns a flag value as string, or undefined. */
  getString(name: string): string | undefined;
  /** Returns a flag as boolean (true if --name, false if --no-name, undefined if absent). */
  getBool(name: string): boolean | undefined;
  /** Returns true if --help or -h is present. */
  help: boolean;
}

/**
 * Parse CLI arguments into positional args and named flags.
 *
 * Supports:
 * - `--flag value` → { flag: "value" }
 * - `--flag` (no value or next arg is a flag) → { flag: true }
 * - `--no-flag` → { flag: false }
 * - `-h` / `--help` → help: true
 * - Positional args (anything not a flag or flag value)
 *
 * @param argv - Arguments to parse (default: process.argv.slice(3) for subcommands)
 * @param boolFlags - Flag names that are always boolean (never consume the next arg as value)
 */
export function parseArgs(argv?: string[], boolFlags: string[] = []): ParsedArgs {
  const args = argv ?? process.argv.slice(3);
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  const boolSet = new Set(boolFlags);

  let i = 0;
  while (i < args.length) {
    const arg = args[i];

    if (arg === "--") {
      // Everything after -- is positional
      positional.push(...args.slice(i + 1));
      break;
    }

    if (arg === "-h" || arg === "--help") {
      flags.help = true;
      i++;
      continue;
    }

    if (arg.startsWith("--no-")) {
      const name = arg.slice(5);
      flags[name] = false;
      i++;
      continue;
    }

    if (arg.startsWith("--")) {
      const name = arg.slice(2);
      const next = args[i + 1];

      if (boolSet.has(name) || !next || next.startsWith("-")) {
        flags[name] = true;
        i++;
      } else {
        flags[name] = next;
        i += 2;
      }
      continue;
    }

    if (arg.startsWith("-") && arg.length === 2) {
      // Short flag like -c value
      const name = arg.slice(1);
      const next = args[i + 1];
      if (!next || next.startsWith("-")) {
        flags[name] = true;
        i++;
      } else {
        flags[name] = next;
        i += 2;
      }
      continue;
    }

    positional.push(arg);
    i++;
  }

  return {
    positional,
    flags,
    getString(name: string): string | undefined {
      const v = flags[name];
      return typeof v === "string" ? v : undefined;
    },
    getBool(name: string): boolean | undefined {
      const v = flags[name];
      return typeof v === "boolean" ? v : undefined;
    },
    get help() {
      return flags.help === true;
    },
  };
}

export function pickFromList(
  rl: readline.Interface,
  items: { name: string; label: string }[],
  prompt: string,
): Promise<string> {
  for (let i = 0; i < items.length; i++) {
    console.log(`  ${i + 1}) ${items[i].label}`);
  }
  return new Promise((resolve) => {
    rl.question(`${prompt}: `, (answer) => {
      const idx = parseInt(answer.trim(), 10) - 1;
      if (idx >= 0 && idx < items.length) {
        resolve(items[idx].name);
      } else {
        const match = items.find((it) => it.name === answer.trim());
        resolve(match ? match.name : "");
      }
    });
  });
}
