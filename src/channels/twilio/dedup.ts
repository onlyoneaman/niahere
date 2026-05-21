/**
 * Time-bounded set for deduplicating webhook deliveries.
 *
 * Twilio retries webhooks on 5xx/timeouts, so the same MessageSid /
 * CallSid can arrive multiple times. We track recently-seen IDs and
 * drop duplicates, expiring entries after `ttlMs`.
 */
export class Dedup {
  private readonly seen = new Map<string, number>();

  constructor(
    private readonly ttlMs: number = 10 * 60 * 1000,
    private readonly maxEntries: number = 5000,
  ) {}

  /** Returns true if this id was already seen recently; false (and records it) otherwise. */
  check(id: string): boolean {
    const now = Date.now();
    const cutoff = now - this.ttlMs;
    const seenAt = this.seen.get(id);
    if (seenAt !== undefined && seenAt > cutoff) return true;
    this.seen.set(id, now);
    if (this.seen.size > this.maxEntries) this.prune(cutoff);
    return false;
  }

  private prune(cutoff: number): void {
    for (const [k, v] of this.seen) {
      if (v <= cutoff) this.seen.delete(k);
    }
  }

  size(): number {
    return this.seen.size;
  }
}
