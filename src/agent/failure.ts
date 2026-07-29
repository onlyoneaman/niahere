import type { FailoverScope } from "./types";

/** Failure classification shared by every backend adapter. */

const RETRYABLE = [/\b500\b/i, /internal server error/i, /overloaded/i, /529/, /rate limit/i];

const MODEL_SCOPED = [
  /model .*not (found|supported|available|allowed)/i,
  /(unknown|invalid|unsupported) model/i,
  /model .*(does not exist|is not supported)/i,
];

const PROVIDER_SCOPED = [
  /authenticat/i,
  /unauthoriz/i,
  /\b(401|403)\b/,
  /not logged in/i,
  /\blogin\b/i,
  /\bcredentials?\b/i,
  /\bapi key\b/i,
  /(session|token) expired/i,
  /\b(econnrefused|enotfound|etimedout|econnreset)\b/i,
  /connection (refused|reset|timed out)/i,
  /network (error|unreachable)/i,
  /failed to refresh available models/i,
];

/** Transient enough for the backend to retry in place. */
export function isRetryable(text: string | null | undefined): boolean {
  const t = text?.trim();
  return !!t && RETRYABLE.some((p) => p.test(t));
}

/**
 * How far the chain should skip. `blank` is what an empty or opaque message
 * implies: a run that reported nothing points at the provider, a structured
 * error that merely lacks a message does not.
 */
export function scopeOf(text: string | null | undefined, blank?: FailoverScope): FailoverScope | undefined {
  const t = text?.trim();
  if (!t || t.toLowerCase() === "unknown error") return blank;
  if (MODEL_SCOPED.some((p) => p.test(t))) return "model";
  if (PROVIDER_SCOPED.some((p) => p.test(t))) return "provider";
  return undefined;
}
