import { runMigrations } from "./migrate";
import { Job } from "./models";
import { closeDb } from "./connection";

interface Seed {
  name: string;
  schedule: string;
  prompt: string;
}

const seeds: Seed[] = [
  {
    name: "heartbeat",
    schedule: "*/10 * * * *",
    prompt:
      "You are a heartbeat monitor. Write the current UTC timestamp and a brief status message. This is a liveness check.",
  },
];

async function run() {
  await runMigrations();

  let added = 0;
  let skipped = 0;

  for (const seed of seeds) {
    const existing = await Job.get(seed.name);
    if (existing) {
      skipped++;
      continue;
    }
    await Job.create(seed.name, seed.schedule, seed.prompt);
    added++;
    console.log(`  + ${seed.name}`);
  }

  console.log(`Seed complete: ${added} added, ${skipped} already exist.`);
  await closeDb();
}

run().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
