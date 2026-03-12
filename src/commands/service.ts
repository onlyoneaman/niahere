import { existsSync, mkdirSync, writeFileSync, unlinkSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { getPaths } from "../utils/paths";

const PLIST_NAME = "com.niahere.agent";
const PLIST_PATH = join(homedir(), "Library", "LaunchAgents", `${PLIST_NAME}.plist`);

function getCliPath(): string {
  // process.argv[1] is the path to the nia CLI script
  return process.argv[1];
}

function buildPlist(): string {
  const paths = getPaths();
  const execPath = process.execPath;
  const cliPath = getCliPath();

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${PLIST_NAME}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${execPath}</string>
    <string>${cliPath}</string>
    <string>run</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${paths.daemonLog}</string>
  <key>StandardErrorPath</key>
  <string>${paths.daemonLog}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${process.env.PATH || "/usr/local/bin:/usr/bin:/bin"}</string>
  </dict>
</dict>
</plist>`;
}

export async function installService(): Promise<void> {
  const paths = getPaths();

  // Ensure directories exist
  mkdirSync(join(homedir(), "Library", "LaunchAgents"), { recursive: true });
  mkdirSync(`${paths.home}/tmp`, { recursive: true });

  // Write plist
  writeFileSync(PLIST_PATH, buildPlist());

  // Load the service
  const unload = Bun.spawn(["launchctl", "unload", PLIST_PATH], {
    stdout: "pipe",
    stderr: "pipe",
  });
  await unload.exited;

  const load = Bun.spawn(["launchctl", "load", PLIST_PATH], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const exitCode = await load.exited;

  if (exitCode !== 0) {
    const stderr = await new Response(load.stderr).text();
    console.log(`Failed to load service: ${stderr.trim()}`);
    process.exit(1);
  }

  console.log("nia service installed and started");
  console.log(`  plist: ${PLIST_PATH}`);
  console.log(`  logs: ${paths.daemonLog}`);
}

export async function uninstallService(): Promise<void> {
  if (!existsSync(PLIST_PATH)) {
    console.log("nia service is not installed");
    return;
  }

  const unload = Bun.spawn(["launchctl", "unload", PLIST_PATH], {
    stdout: "pipe",
    stderr: "pipe",
  });
  await unload.exited;

  try {
    unlinkSync(PLIST_PATH);
  } catch {
    // already gone
  }

  console.log("nia service uninstalled");
}

export function serviceStatus(): void {
  if (!existsSync(PLIST_PATH)) {
    console.log("nia service: not installed");
    return;
  }

  console.log("nia service: installed");
  console.log(`  plist: ${PLIST_PATH}`);
}
