/**
 * Disk-backed cache for outbound Twilio media.
 *
 * Twilio fetches outbound MMS/WhatsApp media by URL, so we write the
 * payload to ~/.niahere/tmp/outbound/<sha>.<ext>, expose it under
 * GET /twilio/media/<sha>.<ext>, and Twilio retrieves it. Disk (not
 * memory) so the URL survives daemon restarts and Twilio's webhook
 * retries within the eviction window.
 *
 * Eviction is opportunistic: capped at 100 files, 10MB total, 24h max
 * age. Oldest-first; expired-first. Runs after every write; cheap
 * enough at this scale (single user, low traffic).
 */
import { mkdir, readdir, readFile, stat, unlink, writeFile } from "fs/promises";
import { createHash } from "crypto";
import { join } from "path";
import { getNiaHome } from "../../utils/paths";
import { log } from "../../utils/log";

const MAX_FILES = 100;
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/ogg": "ogg",
  "audio/wav": "wav",
  "video/mp4": "mp4",
  "application/pdf": "pdf",
};

const FILENAME_RE = /^[a-f0-9]{16,64}\.[a-z0-9]{1,8}$/i;

export function getMediaDir(): string {
  return join(getNiaHome(), "tmp", "outbound");
}

export interface CachedMedia {
  filename: string;
  path: string;
}

export async function cacheMedia(buffer: Uint8Array, mime: string, ext?: string): Promise<CachedMedia> {
  const dir = getMediaDir();
  await mkdir(dir, { recursive: true });
  const resolvedExt = (ext ?? MIME_TO_EXT[mime] ?? "bin").replace(/[^a-z0-9]/gi, "").slice(0, 8) || "bin";
  const hash = createHash("sha256").update(buffer).digest("hex").slice(0, 32);
  const filename = `${hash}.${resolvedExt}`;
  const path = join(dir, filename);
  await writeFile(path, buffer);
  await evict().catch((err) => log.warn({ err }, "media-cache: eviction failed"));
  return { filename, path };
}

export async function readCachedMedia(filename: string): Promise<{ buffer: Buffer; mime: string } | null> {
  if (!FILENAME_RE.test(filename)) return null;
  const path = join(getMediaDir(), filename);
  try {
    const buffer = await readFile(path);
    const ext = filename.split(".").pop()!.toLowerCase();
    const mime = Object.entries(MIME_TO_EXT).find(([, e]) => e === ext)?.[0] ?? "application/octet-stream";
    return { buffer, mime };
  } catch {
    return null;
  }
}

async function evict(): Promise<void> {
  const dir = getMediaDir();
  const entries = await readdir(dir);
  const stats = await Promise.all(
    entries.map(async (name) => {
      const path = join(dir, name);
      const s = await stat(path);
      return { name, path, mtime: s.mtimeMs, size: s.size };
    }),
  );

  const now = Date.now();
  let alive: typeof stats = [];
  for (const s of stats) {
    if (now - s.mtime > MAX_AGE_MS) {
      await unlink(s.path).catch(() => {});
    } else {
      alive.push(s);
    }
  }

  alive.sort((a, b) => a.mtime - b.mtime);

  while (alive.length > MAX_FILES) {
    const victim = alive.shift()!;
    await unlink(victim.path).catch(() => {});
  }

  let totalBytes = alive.reduce((sum, f) => sum + f.size, 0);
  while (totalBytes > MAX_BYTES && alive.length > 0) {
    const victim = alive.shift()!;
    totalBytes -= victim.size;
    await unlink(victim.path).catch(() => {});
  }
}
