import { arch, platform, release, type } from "os";

function shellName(): string {
  const raw = process.env.SHELL || process.env.ComSpec || "";
  if (!raw) return "unknown";
  const normalized = raw.replace(/\\/g, "/");
  return normalized.split("/").filter(Boolean).pop() || "unknown";
}

function osName(osPlatform: NodeJS.Platform): string {
  switch (osPlatform) {
    case "darwin":
      return "macOS";
    case "linux":
      return "Linux";
    case "win32":
      return "Windows";
    default:
      return type();
  }
}

export function getRuntimeOsInfo(): Record<string, string> {
  const osPlatform = platform();
  return {
    osName: osName(osPlatform),
    osType: type(),
    osRelease: release(),
    osPlatform,
    osArch: arch(),
    shell: shellName(),
  };
}
