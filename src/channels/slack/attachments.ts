/**
 * Disk-backed cache for Slack file attachments. Slack file URLs expire and
 * require Authorization on download, so we fetch once per (scope, url),
 * write the bytes + metadata to `~/.niahere/tmp/attachments/<scope>/`, and
 * read from disk on subsequent references. Survives daemon restarts via
 * the metadata sidecar.
 */
import { createHash } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import type { Attachment, AttachmentType } from "../../types";
import { classifyMime, prepareImage, validateAttachment } from "../../utils/attachment";
import { getNiaHome } from "../../utils/paths";
import { log } from "../../utils/log";

interface CachedFile {
  path: string;
  type: AttachmentType;
  mimeType: string;
  filename?: string;
}

function urlHash(url: string): string {
  return createHash("sha256").update(url).digest("hex").slice(0, 16);
}

function safeExtension(filename?: string): string {
  const ext = filename?.split(".").pop();
  return ext && /^[a-zA-Z0-9]{1,16}$/.test(ext) ? ext : "bin";
}

function cacheExtension(filename: string | undefined, mime: string, attType: AttachmentType): string {
  if (attType === "image" && mime !== "image/gif") return "jpg";
  return safeExtension(filename);
}

function loadCached(entry: CachedFile): Attachment {
  return {
    type: entry.type,
    data: readFileSync(entry.path),
    mimeType: entry.mimeType,
    filename: entry.filename,
    sourcePath: entry.path,
  };
}

export class SlackAttachmentCache {
  private readonly attachRoot: string;
  private readonly fileIndex = new Map<string, CachedFile>();

  constructor(private readonly botToken: string) {
    this.attachRoot = join(getNiaHome(), "tmp", "attachments");
    mkdirSync(this.attachRoot, { recursive: true });
  }

  async extract(files: any[], scope: string): Promise<Attachment[]> {
    const attachments: Attachment[] = [];
    const scopedDir = this.dirForScope(scope);

    for (const file of files) {
      const mime = file.mimetype || "application/octet-stream";
      const attType = classifyMime(mime);
      if (!attType) continue;
      if (!file.url_private_download) continue;

      const indexedKey = `${scope}:${file.url_private_download}`;
      const cached = this.fileIndex.get(indexedKey);
      if (cached && existsSync(cached.path)) {
        attachments.push(loadCached(cached));
        continue;
      }

      const hash = urlHash(file.url_private_download);
      const ext = cacheExtension(file.name, mime, attType);
      const diskPath = join(scopedDir, `${hash}.${ext}`);
      const metaPath = join(scopedDir, `${hash}.meta.json`);

      // Re-load from disk if a prior daemon run already wrote this file.
      if (existsSync(diskPath) && existsSync(metaPath)) {
        try {
          const meta = JSON.parse(readFileSync(metaPath, "utf8"));
          const entry: CachedFile = {
            path: diskPath,
            type: meta.type || attType,
            mimeType: meta.mimeType || mime,
            filename: meta.filename || file.name,
          };
          this.fileIndex.set(indexedKey, entry);
          attachments.push(loadCached(entry));
          continue;
        } catch {
          // Corrupt meta — re-download.
        }
      }

      try {
        const raw = await this.download(file.url_private_download);
        const error = validateAttachment(raw);
        if (error) {
          log.warn({ file: file.name, error }, "skipping slack attachment");
          continue;
        }
        let data = raw;
        let finalMime = mime;
        if (attType === "image") {
          const prepared = await prepareImage(raw, mime);
          data = prepared.data;
          finalMime = prepared.mimeType;
        }

        writeFileSync(diskPath, data);
        writeFileSync(metaPath, JSON.stringify({ type: attType, mimeType: finalMime, filename: file.name }));
        const entry: CachedFile = { path: diskPath, type: attType, mimeType: finalMime, filename: file.name };
        this.fileIndex.set(indexedKey, entry);

        attachments.push({
          type: attType,
          data,
          mimeType: finalMime,
          filename: file.name,
          sourcePath: diskPath,
        });
      } catch (err) {
        log.warn({ err, file: file.name }, "failed to download slack file");
      }
    }
    return attachments;
  }

  private dirForScope(scope: string): string {
    const safeScope = scope.replace(/[^a-zA-Z0-9._-]/g, "_");
    const dir = join(this.attachRoot, safeScope);
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  private async download(url: string): Promise<Buffer> {
    const resp = await fetch(url, { headers: { Authorization: `Bearer ${this.botToken}` } });
    if (!resp.ok) throw new Error(`Slack file download failed: ${resp.status}`);
    return Buffer.from(await resp.arrayBuffer());
  }
}
