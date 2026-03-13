import * as readline from "readline";

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
        // Try matching by name
        const match = items.find((it) => it.name === answer.trim());
        resolve(match ? match.name : "");
      }
    });
  });
}
