import { existsSync, mkdirSync, writeFileSync, unlinkSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { getPaths } from "../utils/paths";
import { findDaemonPids } from "../core/daemon";

const PLIST_NAME = "com.niahere.agent";
const SYSTEMD_UNIT = "niahere.service";

function getExecCommand(): [string, string] {
  const execPath = process.execPath;
  // process.argv[1] may be undefined when called outside the normal CLI flow
  // (e.g. from bun -e or programmatic import). Fall back to the known entry point.
  let cliPath = process.argv[1];
  if (!cliPath || cliPath === "undefined") {
    const { resolve } = require("path");
    cliPath = resolve(import.meta.dir, "../cli/index.ts");
  }
  return [execPath, cliPath];
}

// --- macOS launchd ---

function plistPath(): string {
  return join(homedir(), "Library", "LaunchAgents", `${PLIST_NAME}.plist`);
}

function buildPlist(): string {
  const paths = getPaths();
  const [execPath, cliPath] = getExecCommand();

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
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>ThrottleInterval</key>
  <integer>10</integer>
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

async function installLaunchd(): Promise<void> {
  const paths = getPaths();
  const path = plistPath();

  mkdirSync(join(homedir(), "Library", "LaunchAgents"), { recursive: true });
  mkdirSync(`${paths.home}/tmp`, { recursive: true });
  writeFileSync(path, buildPlist());

  // Unload first (ignore errors if not loaded)
  const unload = Bun.spawn(["launchctl", "unload", path], { stdout: "pipe", stderr: "pipe" });
  await unload.exited;

  const load = Bun.spawn(["launchctl", "load", path], { stdout: "pipe", stderr: "pipe" });
  const exitCode = await load.exited;

  if (exitCode !== 0) {
    const stderr = await new Response(load.stderr).text();
    throw new Error(`launchctl load failed: ${stderr.trim()}`);
  }
}

async function uninstallLaunchd(): Promise<void> {
  const path = plistPath();
  if (!existsSync(path)) return;

  // Unload to stop the process and disable KeepAlive respawn.
  // Keep the plist file so RunAtLoad starts the daemon on next login.
  const unload = Bun.spawn(["launchctl", "unload", path], { stdout: "pipe", stderr: "pipe" });
  await unload.exited;
}

function isLaunchdInstalled(): boolean {
  return existsSync(plistPath());
}

// --- Linux systemd ---

function unitPath(): string {
  return join(homedir(), ".config", "systemd", "user", SYSTEMD_UNIT);
}

function buildUnit(): string {
  const paths = getPaths();
  const [execPath, cliPath] = getExecCommand();

  return `[Unit]
Description=nia personal AI assistant
After=network.target

[Service]
ExecStart=${execPath} ${cliPath} run
Restart=always
RestartSec=5
StandardOutput=append:${paths.daemonLog}
StandardError=append:${paths.daemonLog}
Environment=PATH=${process.env.PATH || "/usr/local/bin:/usr/bin:/bin"}

[Install]
WantedBy=default.target
`;
}

async function installSystemd(): Promise<void> {
  const paths = getPaths();
  const path = unitPath();

  mkdirSync(join(homedir(), ".config", "systemd", "user"), { recursive: true });
  mkdirSync(`${paths.home}/tmp`, { recursive: true });
  writeFileSync(path, buildUnit());

  const reload = Bun.spawn(["systemctl", "--user", "daemon-reload"], { stdout: "pipe", stderr: "pipe" });
  await reload.exited;

  const enable = Bun.spawn(["systemctl", "--user", "enable", "--now", SYSTEMD_UNIT], { stdout: "pipe", stderr: "pipe" });
  const exitCode = await enable.exited;

  if (exitCode !== 0) {
    const stderr = await new Response(enable.stderr).text();
    throw new Error(`systemctl enable failed: ${stderr.trim()}`);
  }
}

async function uninstallSystemd(): Promise<void> {
  const path = unitPath();
  if (!existsSync(path)) return;

  const disable = Bun.spawn(["systemctl", "--user", "disable", "--now", SYSTEMD_UNIT], { stdout: "pipe", stderr: "pipe" });
  await disable.exited;

  try { unlinkSync(path); } catch { /* already gone */ }

  const reload = Bun.spawn(["systemctl", "--user", "daemon-reload"], { stdout: "pipe", stderr: "pipe" });
  await reload.exited;
}

function isSystemdInstalled(): boolean {
  return existsSync(unitPath());
}

// --- Public API (platform-aware) ---

export async function registerService(): Promise<void> {
  if (process.platform === "darwin") {
    await installLaunchd();
  } else if (process.platform === "linux") {
    await installSystemd();
  }
  // Windows/other: no-op, daemon still works via startDaemon()
}

export async function unregisterService(): Promise<void> {
  if (process.platform === "darwin") {
    await uninstallLaunchd();
  } else if (process.platform === "linux") {
    await uninstallSystemd();
  }
}

export function isServiceInstalled(): boolean {
  if (process.platform === "darwin") return isLaunchdInstalled();
  if (process.platform === "linux") return isSystemdInstalled();
  return false;
}

/** Restart via service manager. Waits for old process to fully exit before starting new one. */
export async function restartService(): Promise<void> {
  if (process.platform === "darwin") {
    const path = plistPath();
    // Unload — sends SIGTERM and disables KeepAlive respawn
    const unload = Bun.spawn(["launchctl", "unload", path], { stdout: "pipe", stderr: "pipe" });
    if (await unload.exited !== 0) {
      const stderr = await new Response(unload.stderr).text();
      console.error(`  warning: launchctl unload failed: ${stderr.trim()}`);
    }
    // Wait for old daemon to fully exit (graceful shutdown may take time for active engines)
    await waitForDaemonExit(310_000);
    // Load — starts a fresh single instance
    const load = Bun.spawn(["launchctl", "load", path], { stdout: "pipe", stderr: "pipe" });
    if (await load.exited !== 0) {
      const stderr = await new Response(load.stderr).text();
      console.error(`  warning: launchctl load failed: ${stderr.trim()}`);
    }
  } else if (process.platform === "linux") {
    // systemd restart handles stop-wait-start internally
    const restart = Bun.spawn(["systemctl", "--user", "restart", SYSTEMD_UNIT], { stdout: "pipe", stderr: "pipe" });
    await restart.exited;
  }
}

async function waitForDaemonExit(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (findDaemonPids().length === 0) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  // Force kill any stragglers
  for (const pid of findDaemonPids()) {
    try { process.kill(pid, "SIGKILL"); } catch {}
  }
}
