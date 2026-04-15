/** Retry a function with Fibonacci backoff. Only retries on thrown errors (not bad return values). */
export async function withRetry<T>(fn: () => Promise<T>, retries = 3): Promise<T> {
  let a = 1,
    b = 1;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === retries) throw err;
      await new Promise((r) => setTimeout(r, a * 1000));
      [a, b] = [b, a + b];
    }
  }
  throw new Error("unreachable"); // satisfies TS return type
}

const RETRYABLE_PATTERNS = [/\b500\b/i, /internal server error/i, /overloaded/i, /529/, /rate limit/i];

/** Check if an error string from the Claude API looks transient/retryable. */
export function isRetryableApiError(error: string): boolean {
  return RETRYABLE_PATTERNS.some((p) => p.test(error));
}

/** Sleep for ms milliseconds. */
export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
