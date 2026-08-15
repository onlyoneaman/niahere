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
  /** A turn was served. `atHead` means the chain's primary answered it. */
  markServed(provider: string, atHead: boolean): void;
  /** How long the chain has been answering exclusively from a fallback, in ms,
   *  or null when the primary is still serving (or nothing has run yet). */
  fallbackStreakMs(): number | null;
  /** Who has been covering, for the alert text. */
  lastServer(): string | null;
  /** Test seam. */
  clear(): void;
}

export function createProviderHealth(
  cooldownMs: number = DEFAULT_COOLDOWN_MS,
  now: () => number = Date.now,
): ProviderHealth {
  const downUntil = new Map<string, number>();
  // When the primary last answered, and when a fallback first had to cover for
  // it. Failover is designed to be silent, so nothing else in the system can
  // tell the difference between a blip and a provider that has been gone a week.
  let fallbackSince: number | null = null;
  let server: string | null = null;
  return {
    markDown(provider) {
      downUntil.set(provider, now() + cooldownMs);
    },
    markServed(provider, atHead) {
      server = provider;
      if (atHead) fallbackSince = null;
      else fallbackSince ??= now();
    },
    fallbackStreakMs() {
      return fallbackSince === null ? null : now() - fallbackSince;
    },
    lastServer() {
      return server;
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
      fallbackSince = null;
      server = null;
    },
  };
}

export const providerHealth = createProviderHealth();
