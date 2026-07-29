import { isRunning, readPid } from "../utils/pid";
import { errMsg } from "../utils/errors";
import { guardActiveEngines, parseGuardFlags, withDefaultWait } from "../core/engine-guard";
import { startDaemon, stopDaemon } from "../core/daemon";

/** `nia update` — upgrade the global install, then restart if the daemon is up. */
export async function updateCommand(argv: string[]): Promise<void> {
  const guard = withDefaultWait(parseGuardFlags(argv), 1);
  const { version: currentVersion } = await import("../../package.json");
  console.log(`Current: v${currentVersion}`);

  // Never upgrade out from under a live turn.
  if (isRunning() && !(await guardActiveEngines("update", guard))) process.exit(1);

  try {
    const { createBackup } = await import("../commands/backup");
    console.log("Backing up...");
    await createBackup(true);
    console.log("✓ pre-update backup created");
  } catch (err) {
    console.log(`⚠ backup skipped: ${errMsg(err)}`);
  }

  console.log("Updating...");
  const install = Bun.spawn(["npm", "i", "-g", "niahere@latest"], { stdio: ["ignore", "inherit", "inherit"] });
  if ((await install.exited) !== 0) {
    console.error("Update failed.");
    process.exit(1);
  }

  const check = Bun.spawn(["npm", "view", "niahere", "version"], { stdout: "pipe", stderr: "pipe" });
  const newVersion = (await new Response(check.stdout).text()).trim();
  await check.exited;

  if (newVersion === currentVersion) {
    console.log("Already on latest.");
    return;
  }

  console.log(`Updated: v${currentVersion} → v${newVersion}`);
  if (!isRunning()) return;

  console.log("Restarting daemon...");
  const { isServiceInstalled, restartService } = await import("../commands/service");
  if (isServiceInstalled()) {
    await restartService({ force: guard.force });
  } else {
    stopDaemon({ force: guard.force });
    startDaemon();
  }
  console.log("Restarted.");
}

/** `nia channels <on|off> [name]` — toggle channels and nudge a running daemon. */
export async function channelsToggleCommand(sub: string, target?: string): Promise<void> {
  const { updateRawConfig } = await import("../utils/config");
  const SUPPORTED = new Set(["telegram", "slack", "phone", "sms", "whatsapp"]);
  const enabled = sub === "on";

  if (target) {
    if (!SUPPORTED.has(target)) {
      console.error(`Usage: nia channels <on|off> [${[...SUPPORTED].join("|")}]`);
      process.exit(1);
    }
    updateRawConfig({ channels: { ...(enabled ? { enabled: true } : {}), [target]: { enabled } } });
  } else {
    updateRawConfig({ channels: { enabled } });
  }

  const what = target ?? "channels";
  const state = enabled ? "enabled" : "disabled";
  const pid = readPid();
  if (pid && isRunning()) {
    process.kill(pid, "SIGHUP");
    console.log(`${what} ${state}`);
  } else {
    console.log(`${what} ${state} — start nia to apply`);
  }
}
