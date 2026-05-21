/**
 * Slack watch channels: hot-reloads `channels.slack.watch` entries from
 * config.yaml (plus any behavior files they reference) on each inbound
 * message, gated by an mtime check so we don't re-parse config on every
 * call. Keyed by `channel_id` (the part before `#` in the config key).
 */
import { statSync } from "fs";
import { getConfig, resetConfig } from "../../utils/config";
import { getPaths } from "../../utils/paths";
import { log } from "../../utils/log";
import { resolveWatchBehavior } from "../../utils/watches";

export interface WatchEntry {
  name: string;
  behavior: string;
}

function maxMtime(paths: string[]): number {
  let max = 0;
  for (const p of paths) {
    try {
      const m = statSync(p).mtimeMs;
      if (m > max) max = m;
    } catch {
      // missing file — ignore
    }
  }
  return max;
}

export class SlackWatchReloader {
  private cache = new Map<string, WatchEntry>();
  private filePaths: string[] = [];
  private lastReloadMtime = 0;

  /** Re-parse config + behavior files if any have been modified since the last read. */
  reload(): Map<string, WatchEntry> {
    const configPath = getPaths().config;
    const mtime = maxMtime([configPath, ...this.filePaths]);
    if (mtime === 0) return this.cache;
    if (mtime === this.lastReloadMtime) return this.cache;

    resetConfig();
    const watch = getConfig().channels.slack.watch;
    const fresh = new Map<string, WatchEntry>();
    const freshFiles: string[] = [];

    if (watch) {
      for (const [key, entry] of Object.entries(watch)) {
        if (!entry.enabled) continue;
        const hashIdx = key.indexOf("#");
        if (hashIdx === -1) {
          log.warn({ channel: key }, "slack: watch key must use channel_id#name format, skipping");
          continue;
        }
        const id = key.slice(0, hashIdx);
        const name = key.slice(hashIdx + 1);
        const resolved = resolveWatchBehavior(entry.behavior, name);
        if (resolved.filePath) freshFiles.push(resolved.filePath);
        fresh.set(id, { name, behavior: resolved.behavior });
      }
    }

    if (fresh.size !== this.cache.size) {
      log.info({ count: fresh.size }, "slack: watch channels reloaded");
    }

    this.cache = fresh;
    this.filePaths = freshFiles;
    this.lastReloadMtime = maxMtime([configPath, ...freshFiles]);
    return this.cache;
  }
}
