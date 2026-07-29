import { existsSync } from "fs";
import { getPaths } from "../utils/paths";
import { withDb } from "../db/with-db";
import { Message } from "../db/models";
import { localTime } from "../utils/time";
import { errMsg } from "../utils/errors";

const SNIPPET = 120;

/** `nia history [room]` — recent messages, newest last. */
export async function historyCommand(room?: string): Promise<void> {
  try {
    await withDb(async () => {
      const messages = await Message.getRecent(20, room);
      if (messages.length === 0) {
        console.log("No messages yet.");
        return;
      }
      for (const m of messages) {
        const time = localTime(new Date(m.createdAt));
        const prefix = m.sender === "user" ? "you" : m.sender;
        const roomTag = room ? "" : `[${m.room}] `;
        const snippet = m.content.length > SNIPPET ? m.content.slice(0, SNIPPET) + "..." : m.content;
        console.log(`  ${roomTag}${time}  ${prefix} > ${snippet.replace(/\n/g, " ")}`);
      }
    });
  } catch (err) {
    console.error(`Failed: ${errMsg(err)}`);
    process.exit(1);
  }
}

/** `nia logs [-f] [--channel <name>]` — tail the daemon log. */
export async function logsCommand(args: string[]): Promise<void> {
  const { daemonLog } = getPaths();
  if (!existsSync(daemonLog)) {
    console.error("No daemon log found. Is nia running?");
    process.exit(1);
  }

  const follow = args.includes("-f") || args.includes("--follow");
  const chIdx = args.indexOf("--channel");
  const channelFilter = chIdx !== -1 && args[chIdx + 1] ? args[chIdx + 1] : null;
  const tailArgs = follow ? ["tail", "-f", daemonLog] : ["tail", channelFilter ? "-200" : "-50", daemonLog];

  if (!channelFilter) {
    const proc = Bun.spawn(tailArgs, { stdio: ["ignore", "inherit", "inherit"] });
    await proc.exited;
    return;
  }

  const tail = Bun.spawn(tailArgs, { stdio: ["ignore", "pipe", "inherit"] });
  const grep = Bun.spawn(["grep", "-i", channelFilter], { stdio: [tail.stdout, "inherit", "inherit"] });
  await grep.exited;
}
