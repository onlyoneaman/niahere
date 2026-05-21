/**
 * Sliding-window rate limiter keyed by an arbitrary string (e.g. caller
 * E.164). Protects against runaway costs when the WhatsApp Sandbox's
 * shared number gets random opt-ins and someone spams.
 */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly maxPerWindow: number = 30,
    private readonly windowMs: number = 60_000,
  ) {}

  /** Returns true if this hit was allowed (and recorded); false if over limit. */
  allow(key: string): boolean {
    const now = Date.now();
    const cutoff = now - this.windowMs;
    const arr = this.hits.get(key) ?? [];
    const recent = arr.filter((t) => t > cutoff);
    if (recent.length >= this.maxPerWindow) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    return true;
  }

  /** Drop tracking for a key (e.g. owner number — never rate-limit yourself). */
  exempt(key: string): void {
    this.hits.delete(key);
  }
}
