import { existsSync } from "fs";
import type { AgentBackend } from "./types";
import type { ChainEntry } from "./chain";
import { ClaudeBackend } from "./backends/claude";
import { CodexBackend, resolveCodexBin } from "./backends/codex";
import { getConfig } from "../utils/config";
import { resolveModel, providerDefault, PROVIDER_ORDER, type ProviderName } from "./models";

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

/** Gemini is resolvable in config but has no adapter yet. */
const IMPLEMENTED: ProviderName[] = ["claude", "codex"];

function isAvailable(provider: ProviderName): boolean {
  if (provider === "claude") return true;
  if (provider === "codex") return existsSync(resolveCodexBin());
  return false;
}

export interface ChainDeps {
  available: (provider: ProviderName) => boolean;
}

/**
 * Providers the config never named are appended with their default model, so a
 * bare config still has somewhere to go — but only if they can run here.
 * Configured models are always kept, so a misconfiguration surfaces as a real
 * error rather than vanishing.
 */
export function buildChain(
  model: string,
  fallbackModels: string[],
  deps: ChainDeps = { available: isAvailable },
): ChainEntry[] {
  const configured = [model, ...fallbackModels].map(resolveModel);
  const named = new Set(configured.map((r) => r.provider));
  const implicit = PROVIDER_ORDER.filter((p) => !named.has(p) && deps.available(p)).map(providerDefault);

  const seen = new Set<string>();
  const entries: ChainEntry[] = [];
  for (const ref of [...configured, ...implicit]) {
    if (!IMPLEMENTED.includes(ref.provider)) continue;
    const key = `${ref.provider}:${ref.model ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push({ backend: getBackend(ref.provider), model: ref.model });
  }
  return entries;
}

export function resolveChain(): ChainEntry[] {
  if (chainOverride) return chainOverride;
  if (override) return [{ backend: override }];
  const cfg = getConfig();
  return buildChain(cfg.model, cfg.fallback_models);
}
