import { isRunning, readPid } from "../core/daemon";
import { getConfig, resetConfig, updateRawConfig } from "../utils/config";

function printUsage(): void {
  console.log("Usage: nia model [default|sonnet|opus|opusplan|haiku|<model-id>]");
}

export async function modelCommand(argv: string[] = []): Promise<void> {
  const model = argv[0];

  if (!model) {
    console.log(`model = ${getConfig().model}`);
    return;
  }

  if (model === "--help" || model === "-h") {
    printUsage();
    return;
  }

  updateRawConfig({ model });
  resetConfig();
  console.log(`model = ${model}`);

  const pid = readPid();
  if (pid && isRunning()) {
    process.kill(pid, "SIGHUP");
  }
}
