import type { AgentBackend } from "./types";
import { ClaudeBackend } from "./backends/claude";

/**
 * Backend selection — the ONE place backend identity is resolved. Consumers call
 * `getBackend()` and depend only on the `AgentBackend` interface, so no
 * `if (backend === …)` ever leaks into the orchestration loop.
 *
 * Phase 1: always the in-process Claude backend. Phase 2+ adds Codex/Gemini and
 * a role/per-job selector; Phase 3 adds the ordered-fallback failover list.
 */
let claudeBackend: ClaudeBackend | null = null;
let override: AgentBackend | null = null;

export function getBackend(_name?: "claude" | "codex" | "gemini"): AgentBackend {
  if (override) return override;
  if (!claudeBackend) claudeBackend = new ClaudeBackend();
  return claudeBackend;
}

/** Test seam: force `getBackend()` to return a specific backend; pass null to reset. */
export function setBackend(backend: AgentBackend | null): void {
  override = backend;
}
