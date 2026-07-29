import type { AgentBackend, FailoverScope } from "./types";

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
  private index = 0;
  private readonly down = new Set<string>();

  constructor(private readonly chain: ChainEntry[]) {}

  get current(): ChainEntry | undefined {
    return this.chain[this.index];
  }

  get atHead(): boolean {
    return this.index === 0;
  }

  /** Record the failure and move on. Undefined when nothing usable is left. */
  advance(scope: FailoverScope): ChainEntry | undefined {
    if (scope === "provider") this.down.add(this.chain[this.index]!.backend.name);
    const next = this.chain.findIndex((e, i) => i > this.index && !this.down.has(e.backend.name));
    if (next === -1) return undefined;
    this.index = next;
    return this.chain[next];
  }
}
