/**
 * Process-wide provider cooldown. Without it every job and every chat turn
 * re-discovers the same outage from scratch, paying the full retry ladder before
 * failing over; with it a provider that just failed is skipped until it has had
 * time to recover, and picked up again once the cooldown lapses.
 */

const DEFAULT_COOLDOWN_MS = 5 * 60 * 1000;

export interface ProviderHealth {
  markDown(provider: string): void;
  isDown(provider: string): boolean;
  /** Test seam. */
  clear(): void;
}

export function createProviderHealth(
  cooldownMs: number = DEFAULT_COOLDOWN_MS,
  now: () => number = Date.now,
): ProviderHealth {
  const downUntil = new Map<string, number>();
  return {
    markDown(provider) {
      downUntil.set(provider, now() + cooldownMs);
    },
    isDown(provider) {
      const until = downUntil.get(provider);
      if (until === undefined) return false;
      if (now() > until) {
        downUntil.delete(provider);
        return false;
      }
      return true;
    },
    clear() {
      downUntil.clear();
    },
  };
}

export const providerHealth = createProviderHealth();
