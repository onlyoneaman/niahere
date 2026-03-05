import { resolve } from "path";
import { isRunning, readPid, runDaemon, startDaemon, stopDaemon } from "./daemon";
import { readState } from "./logger";

const workspace = resolve(import.meta.dir, "..");
const command = process.argv[2];

switch (command) {
  case "start": {
    if (isRunning(workspace)) {
      const pid = readPid(workspace);
      console.log(`niahere is already running (pid: ${pid})`);
      process.exit(1);
    }
    const pid = startDaemon(workspace);
    console.log(`niahere started (pid: ${pid})`);
    break;
  }

  case "stop": {
    if (!isRunning(workspace)) {
      console.log("niahere is not running");
      process.exit(1);
    }
    stopDaemon(workspace);
    console.log("niahere stopped");
    break;
  }

  case "status": {
    const running = isRunning(workspace);
    const pid = readPid(workspace);
    console.log(`niahere: ${running ? `running (pid: ${pid})` : "stopped"}`);

    const state = readState(workspace);
    const entries = Object.entries(state);
    if (entries.length > 0) {
      console.log("\nJobs:");
      for (const [name, info] of entries) {
        console.log(`  ${name}: ${info.status} (last: ${info.lastRun}, ${info.duration_ms}ms)`);
      }
    }
    break;
  }

  case "run": {
    // Foreground mode — used by daemon's child process
    await runDaemon(workspace);
    break;
  }

  default:
    console.log("Usage: niahere <start|stop|status>");
    process.exit(1);
}
