import { ActiveEngine } from "../db/models";
import { withDb } from "../db/with-db";
import { errMsg } from "../utils/errors";
import { dateSortValue, formatTimeLine } from "../utils/format";

function hasFullFlag(argv: string[]): boolean {
  return argv.includes("--full");
}

export async function activeCommand(argv: string[] = []): Promise<void> {
  const full = hasFullFlag(argv);
  const now = new Date();
  let engines: Awaited<ReturnType<typeof ActiveEngine.list>> = [];

  try {
    await withDb(async () => {
      engines = await ActiveEngine.list();
    });
  } catch (err) {
    console.error(`active engines unavailable: ${errMsg(err)}`);
    process.exitCode = 1;
    return;
  }

  if (!full) {
    console.log(String(engines.length));
    return;
  }

  console.log(`Active engines: ${engines.length === 0 ? "none" : engines.length}`);
  for (const engine of engines.sort((a, b) => dateSortValue(a.startedAt) - dateSortValue(b.startedAt))) {
    const started = formatTimeLine(engine.startedAt, now);
    const ping = formatTimeLine(engine.lastPing, now);
    console.log(`  ${engine.room} (${engine.channel}) • started ${started} • last ping ${ping}`);
  }
}
