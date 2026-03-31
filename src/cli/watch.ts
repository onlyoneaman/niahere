import { readRawConfig } from "../utils/config";
import { addWatchChannel, removeWatchChannel, enableWatchChannel, disableWatchChannel } from "../mcp/tools";
import { fail, ICON_PASS, ICON_FAIL } from "../utils/cli";

const HELP = `Usage: nia watch <command>

Commands:
  list                              List watch channels (default)
  add <channel_id#name> <behavior>  Add a watch channel
  remove <channel_id#name>          Remove a watch channel
  enable <channel_id#name>          Enable a watch channel
  disable <channel_id#name>         Disable a watch channel`;

export function watchCommand(): void {
  const sub = process.argv[3];

  if (sub === "--help" || sub === "-h" || sub === "help") {
    console.log(HELP);
    return;
  }

  switch (sub) {
    case "list":
    case undefined: {
      const raw = readRawConfig();
      const channels = (raw.channels || {}) as Record<string, unknown>;
      const slack = (channels.slack || {}) as Record<string, unknown>;
      const watch = (slack.watch || {}) as Record<string, unknown>;

      const entries = Object.entries(watch);
      if (entries.length === 0) {
        console.log("No watch channels configured.");
        break;
      }
      for (const [key, val] of entries) {
        const cfg = val as Record<string, unknown>;
        const enabled = cfg.enabled !== false;
        const icon = enabled ? ICON_PASS : ICON_FAIL;
        const behavior = typeof cfg.behavior === "string" ? cfg.behavior.slice(0, 80).replace(/\n/g, " ") : "";
        console.log(`  ${icon} ${key}  ${behavior}${behavior.length >= 80 ? "..." : ""}`);
      }
      break;
    }

    case "add": {
      const name = process.argv[4];
      const behavior = process.argv.slice(5).join(" ");
      if (!name || !behavior) {
        fail('Usage: nia watch add <channel_id#name> <behavior>');
      }
      console.log(addWatchChannel(name, behavior));
      break;
    }

    case "remove": {
      const name = process.argv[4];
      if (!name) fail("Usage: nia watch remove <channel_id#name>");
      console.log(removeWatchChannel(name));
      break;
    }

    case "enable": {
      const name = process.argv[4];
      if (!name) fail("Usage: nia watch enable <channel_id#name>");
      console.log(enableWatchChannel(name));
      break;
    }

    case "disable": {
      const name = process.argv[4];
      if (!name) fail("Usage: nia watch disable <channel_id#name>");
      console.log(disableWatchChannel(name));
      break;
    }

    default:
      console.error(`Unknown subcommand: ${sub}`);
      console.log(HELP);
      process.exit(1);
  }
}
