import type { BackendName } from "../types/config";

/** Model → provider resolution. Config names models, never backends, so one
 *  provider's model id can never reach another. */

export type ProviderName = BackendName;

export interface ModelRef {
  provider: ProviderName;
  /** Absent → let the provider pick. */
  model?: string;
}

/** Order of the implicit cross-provider tail. */
export const PROVIDER_ORDER: readonly ProviderName[] = ["claude", "codex", "gemini"];

/** Selects a provider without naming a model. */
const BARE_PROVIDERS: Record<string, ProviderName> = {
  default: "claude",
  claude: "claude",
  codex: "codex",
  gemini: "gemini",
};

/** Short names the provider understands directly. */
const ALIASES: Record<string, ProviderName> = {
  sonnet: "claude",
  opus: "claude",
  opusplan: "claude",
  haiku: "claude",
};

const PREFIXES: [RegExp, ProviderName][] = [
  [/^claude[-.]/, "claude"],
  [/^(gpt|o[134]|codex)[-.]/, "codex"],
  [/^gemini[-.]/, "gemini"],
];

/** Unrecognized names are assumed to be Claude's — a rejected model is a
 *  model-scoped failure, so a typo degrades to the next entry. */
export function resolveModel(name: string): ModelRef {
  const model = name.trim();
  const key = model.toLowerCase();

  const bare = BARE_PROVIDERS[key];
  if (bare) return { provider: bare };

  const alias = ALIASES[key];
  if (alias) return { provider: alias, model };

  for (const [pattern, provider] of PREFIXES) {
    if (pattern.test(key)) return { provider, model };
  }
  return { provider: "claude", model };
}

export function providerDefault(provider: ProviderName): ModelRef {
  return { provider };
}

/** Providers with an adapter. Gemini resolves in config but cannot run. */
export const IMPLEMENTED: readonly ProviderName[] = ["claude", "codex"];

export interface ChainDeps {
  available: (provider: ProviderName) => boolean;
}

/**
 * The ordered attempts a chain will make, as model refs — no backends built, so
 * this is safe to call from anywhere that only wants to inspect the plan.
 *
 * Providers the config never named are appended with their default model, so a
 * bare config still has somewhere to go — but only if they can run here.
 * Configured models are always kept, so a misconfiguration surfaces as a real
 * error rather than vanishing.
 */
export function planChain(model: string, fallbackModels: string[], deps: ChainDeps): ModelRef[] {
  const configured = [model, ...fallbackModels].map(resolveModel);
  const named = new Set(configured.map((r) => r.provider));
  const implicit = PROVIDER_ORDER.filter((p) => !named.has(p) && deps.available(p)).map(providerDefault);

  const seen = new Set<string>();
  const plan: ModelRef[] = [];
  for (const ref of [...configured, ...implicit]) {
    if (!IMPLEMENTED.includes(ref.provider)) continue;
    const key = `${ref.provider}:${ref.model ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    plan.push(ref);
  }
  return plan;
}

/** `provider:model` for logs and health output. */
export function describeRef(ref: ModelRef): string {
  return `${ref.provider}:${ref.model ?? "default"}`;
}
