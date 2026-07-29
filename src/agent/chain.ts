import type { AgentBackend, FailoverScope } from "./types";
import { providerHealth, type ProviderHealth } from "./health";

/** One attempt: a backend paired with the model to run it on. */
export interface ChainEntry {
  backend: AgentBackend;
  /** Absent → let the backend pick its own default. */
  model?: string;
}

/** `provider:model` for logs. */
export function describeEntry(entry: ChainEntry): string {
  return `${entry.backend.name}:${entry.model ?? "default"}`;
}

/**
 * Walks the resolved chain. A model-scoped failure advances one entry — possibly
 * the same provider on another model; a provider-scoped one writes that provider
 * off for the rest of the run.
 */
export class ChainCursor {
  private index: number;
  private readonly down = new Set<string>();

  constructor(
    private readonly chain: ChainEntry[],
    private readonly health: ProviderHealth = providerHealth,
  ) {
    // Skip a provider that recently failed, but never strand the run: if every
    // provider is cooling down, start at the head and let it try.
    const usable = chain.findIndex((e) => !health.isDown(e.backend.name));
    this.index = usable === -1 ? 0 : usable;
  }

  get current(): ChainEntry | undefined {
    return this.chain[this.index];
  }

  get atHead(): boolean {
    return this.index === 0;
  }

  /** Position in the chain, for deciding whether a fresh cursor would differ. */
  get entry(): ChainEntry | undefined {
    return this.chain[this.index];
  }

  /** Record the failure and move on. Undefined when nothing usable is left. */
  advance(scope: FailoverScope): ChainEntry | undefined {
    if (scope === "provider") {
      const name = this.chain[this.index]!.backend.name;
      this.down.add(name);
      this.health.markDown(name);
    }
    const next = this.chain.findIndex((e, i) => i > this.index && !this.down.has(e.backend.name));
    if (next === -1) return undefined;
    this.index = next;
    return this.chain[next];
  }
}
