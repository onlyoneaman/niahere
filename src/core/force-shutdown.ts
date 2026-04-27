import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { getNiaHome } from "../utils/paths";

const FORCE_MARKER_MAX_AGE_MS = 10 * 60 * 1000;

interface ForceShutdownMarker {
  createdAt: number;
  pids: number[];
}

function markerPath(): string {
  return join(getNiaHome(), "tmp", "force-shutdown.json");
}

export function requestForceShutdown(pids: number[] = []): void {
  const path = markerPath();
  mkdirSync(dirname(path), { recursive: true });
  const uniquePids = [...new Set(pids.filter((pid) => Number.isInteger(pid) && pid > 0))];
  const marker: ForceShutdownMarker = { createdAt: Date.now(), pids: uniquePids };
  writeFileSync(path, JSON.stringify(marker));
}

export function clearForceShutdownRequest(): void {
  try {
    unlinkSync(markerPath());
  } catch {
    // already gone
  }
}

export function consumeForceShutdownRequest(pid: number = process.pid): boolean {
  const path = markerPath();
  if (!existsSync(path)) return false;

  let marker: ForceShutdownMarker;
  try {
    marker = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    clearForceShutdownRequest();
    return false;
  }

  if (Date.now() - marker.createdAt > FORCE_MARKER_MAX_AGE_MS) {
    clearForceShutdownRequest();
    return false;
  }

  const applies = marker.pids.length === 0 || marker.pids.includes(pid);
  if (applies) clearForceShutdownRequest();
  return applies;
}
