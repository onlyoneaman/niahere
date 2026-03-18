import * as readline from "readline";

// ANSI colors
export const DIM = "\x1b[2m";
export const BOLD = "\x1b[1m";
export const RESET = "\x1b[0m";
export const RED = "\x1b[31m";
export const GREEN = "\x1b[32m";
export const YELLOW = "\x1b[33m";
export const CYAN = "\x1b[36m";
export const CLEAR_LINE = "\x1b[2K\r";

// Icons
export const ICON_PASS = "\u2713";
export const ICON_FAIL = "\u2717";
export const ICON_WARN = "\u26A0";
export const ICON_RUNNING = "\u21bb";

// Spinner frames
export const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export function fail(msg: string): never {
  console.log(msg);
  process.exit(1);
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
