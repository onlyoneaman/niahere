import type { AgentBackend } from "./types";
import type { ChainEntry } from "./chain";
import { ClaudeBackend } from "./backends/claude";
import { CodexBackend } from "./backends/codex";
import { codexAvailable } from "./catalog";
import { getConfig } from "../utils/config";
import { planChain, type ChainDeps, type ProviderName } from "./models";

/** The ONE place backend identity is resolved. */
let claudeBackend: ClaudeBackend | null = null;
let codexBackend: CodexBackend | null = null;
let override: AgentBackend | null = null;
let chainOverride: ChainEntry[] | null = null;

export function getBackend(name?: ProviderName): AgentBackend {
  if (override) return override;
  if (name === "codex") return (codexBackend ??= new CodexBackend());
  return (claudeBackend ??= new ClaudeBackend());
}

/** Test seam: force `getBackend()` to return a specific backend; null resets. */
export function setBackend(backend: AgentBackend | null): void {
  override = backend;
}

/** Test seam: force `resolveChain()` to return a specific chain; null resets. */
export function setBackendChain(chain: ChainEntry[] | null): void {
  chainOverride = chain;
}

export function isAvailable(provider: ProviderName): boolean {
  if (provider === "claude") return true;
  if (provider === "codex") return codexAvailable();
  return false;
}

export type { ChainDeps };

export function buildChain(
  model: string,
  fallbackModels: string[],
  deps: ChainDeps = { available: isAvailable },
): ChainEntry[] {
  return planChain(model, fallbackModels, deps).map((ref) => ({
    backend: getBackend(ref.provider),
    model: ref.model,
  }));
}

export function resolveChain(): ChainEntry[] {
  if (chainOverride) return chainOverride;
  if (override) return [{ backend: override }];
  const cfg = getConfig();
  return buildChain(cfg.model, cfg.fallback_models);
}
