/**
 * Watch behavior resolver.
 *
 * Each watch lives in `<watchesDir>/<name>/` and can contain:
 *   - behavior.md — the prompt (optional)
 *   - state.md    — working memory (future)
 *
 * The `behavior` field in config.yaml is optional and has three forms:
 *   1. omitted/empty: use `watchName` (the part after `#` in the config key) as the identity
 *   2. single token `[a-zA-Z0-9_-]+`: override identity, loads watches/<token>/behavior.md
 *   3. prose (contains whitespace or punctuation): inline behavior
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { getPaths } from "./paths";
import { log } from "./log";

const NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;

export interface ResolvedBehavior {
  /** Final behavior text used at runtime. Empty string if no behavior was found. */
  behavior: string;
  /** Absolute path to the behavior file the text was loaded from, or null if inline/missing. */
  filePath: string | null;
}

/**
 * Resolve a watch behavior.
 *
 * @param behaviorValue The raw `behavior` field from config (may be undefined/empty)
 * @param watchName The watch identity — the part after `#` in the config key
 */
export function resolveWatchBehavior(behaviorValue: string | undefined | null, watchName: string): ResolvedBehavior {
  const raw = behaviorValue ?? "";
  const trimmed = raw.trim();

  // Form 3: inline prose (contains whitespace or anything not in NAME_PATTERN)
  if (trimmed && !NAME_PATTERN.test(trimmed)) {
    return { behavior: raw, filePath: null };
  }

  // Form 1 or 2: resolve to a file
  // Form 2 (explicit override) wins over Form 1 (implicit from watchName)
  const name = trimmed || watchName;
  if (!NAME_PATTERN.test(name)) {
    log.warn({ watchName, behaviorValue }, "watch: could not derive a valid name for file lookup");
    return { behavior: "", filePath: null };
  }

  const filePath = join(getPaths().watchesDir, name, "behavior.md");
  if (!existsSync(filePath)) {
    log.warn({ name, filePath }, "watch behavior file not found — watch will run without explicit behavior");
    return { behavior: "", filePath: null };
  }

  try {
    const content = readFileSync(filePath, "utf8").trim();
    if (!content) {
      log.warn({ filePath }, "watch behavior file is empty");
      return { behavior: "", filePath: null };
    }
    return { behavior: content, filePath };
  } catch (err) {
    log.error({ err, filePath }, "failed to read watch behavior file");
    return { behavior: "", filePath: null };
  }
}
