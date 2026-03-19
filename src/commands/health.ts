import { runHealthChecks } from "../core/health";

export async function healthCommand(): Promise<void> {
  const { GREEN, YELLOW, RED, RESET, ICON_PASS, ICON_FAIL, ICON_WARN } = await import("../utils/cli");
  const icons: Record<string, string> = {
    ok: GREEN + ICON_PASS + RESET,
    warn: YELLOW + ICON_WARN + RESET,
    fail: RED + ICON_FAIL + RESET,
  };

  const checks = await runHealthChecks();

  console.log();
  for (const c of checks) {
    console.log("  " + icons[c.status] + " " + c.name.padEnd(12) + " " + c.detail);
  }
  console.log();

  const failCount = checks.filter((c) => c.status === "fail").length;
  if (failCount > 0) process.exit(1);
}
