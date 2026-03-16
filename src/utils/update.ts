import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { getNiaHome } from "./paths";

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const PACKAGE_NAME = "niahere";

type UpdateCache = {
  latest: string;
  checkedAt: number;
};

function cachePath(): string {
  return resolve(getNiaHome(), "tmp/update-check.json");
}

function readCache(): UpdateCache | null {
  const path = cachePath();
  if (!existsSync(path)) return null;
  try {
    const data = JSON.parse(readFileSync(path, "utf8"));
    if (data.latest && data.checkedAt && Date.now() - data.checkedAt < CACHE_TTL_MS) {
      return data;
    }
  } catch {}
  return null;
}

function writeCache(latest: string): void {
  const path = cachePath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ latest, checkedAt: Date.now() }));
}

async function fetchLatestVersion(): Promise<string | null> {
  try {
    const resp = await fetch(`https://registry.npmjs.org/${PACKAGE_NAME}/latest`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!resp.ok) return null;
    const data = await resp.json() as { version?: string };
    return data.version ?? null;
  } catch {
    return null;
  }
}

function isNewer(latest: string, current: string): boolean {
  const [la, lb, lc] = latest.split(".").map(Number);
  const [ca, cb, cc] = current.split(".").map(Number);
  if (la !== ca) return la > ca;
  if (lb !== cb) return lb > cb;
  return lc > cc;
}

/** Check if a newer version is available. Returns update info or null. Non-blocking, cached 24h. */
export async function checkForUpdate(currentVersion: string): Promise<{ current: string; latest: string } | null> {
  const cached = readCache();
  if (cached) {
    return isNewer(cached.latest, currentVersion) ? { current: currentVersion, latest: cached.latest } : null;
  }

  const latest = await fetchLatestVersion();
  if (!latest) return null;

  writeCache(latest);
  return isNewer(latest, currentVersion) ? { current: currentVersion, latest } : null;
}
