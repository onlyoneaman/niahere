/**
 * Watch behavior resolver.
 *
 * A watch entry's `behavior` field in config.yaml can be either:
 *   1. An inline behavior string (any prose with whitespace/newlines)
 *   2. A simple name like `kay-monitor` — resolved from `<watchesDir>/<name>.md`
 *
 * Detection rule: if the value is a single token matching [a-zA-Z0-9_-]+
 * (no whitespace, no newlines), treat it as a file reference.
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { getPaths } from "./paths";
import { log } from "./log";

const NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;

export interface ResolvedBehavior {
  /** Final behavior text used at runtime */
  behavior: string;
  /** Absolute path to the file the behavior was loaded from, or null if inline */
  filePath: string | null;
}

/** Resolve a single behavior value from config into runtime behavior text. */
export function resolveWatchBehavior(value: string): ResolvedBehavior {
  const trimmed = value.trim();

  // Inline behavior — contains whitespace, newlines, or punctuation
  if (!NAME_PATTERN.test(trimmed)) {
    return { behavior: value, filePath: null };
  }

  // Looks like a name — try to load from watches dir
  const filePath = join(getPaths().watchesDir, `${trimmed}.md`);
  if (!existsSync(filePath)) {
    log.warn({ name: trimmed, filePath }, "watch behavior file not found — using raw value as inline behavior");
    return { behavior: value, filePath: null };
  }

  try {
    const content = readFileSync(filePath, "utf8").trim();
    if (!content) {
      log.warn({ filePath }, "watch behavior file is empty — using raw value");
      return { behavior: value, filePath: null };
    }
    return { behavior: content, filePath };
  } catch (err) {
    log.error({ err, filePath }, "failed to read watch behavior file");
    return { behavior: value, filePath: null };
  }
}
