import type { FailoverScope } from "./types";

/**
 * Failure classification shared by every backend adapter.
 *
 * Prefer the structured signal. Agents talk about logins, credentials and API
 * keys all day, and the codex binary bundles an AWS SDK that mentions them too,
 * so prose is only consulted when there is no HTTP status to go on — and the
 * patterns that read prose are anchored to failure wording rather than to the
 * bare nouns.
 */

const RETRYABLE = [/\b500\b/i, /internal server error/i, /overloaded/i, /529/, /rate limit/i];

const MODEL_SCOPED = [
  /model .*not (found|supported|available|allowed)/i,
  /(unknown|invalid|unsupported) model/i,
  /model .*(does not exist|is not supported)/i,
  /context ?window ?exceeded/i,
];

const PROVIDER_SCOPED = [
  /not logged in/i,
  /failed to (authenticate|authorize)/i,
  /(authentication|authorization) (failed|required|error)/i,
  /\b(authorizationfailed|authorizationrequired|noauthorizationsupport)\b/i,
  /failed to (load|refresh)\b.{0,40}\b(credential|token|auth)/i,
  /(session|token|refresh token|credentials) (has |have )?expired/i,
  /\b(tokenexpired|tokenrefreshfailed|refreshtokenfailed|tokenexchangefailed)\b/i,
  /invalid (api[ -]?key|credentials|token)/i,
  /\b(401 unauthorized|403 forbidden)\b/i,
  /\bstatus:? (401|403)\b/i,
  /(usage limit reached|quota exceeded)/i,
  /\b(usagelimitreached|quotaexceeded)\b/i,
  /\b(econnrefused|enotfound|etimedout|econnreset)\b/i,
  /connection (refused|reset|timed out)/i,
  /network (error|unreachable)/i,
  /failed to refresh available models/i,
];

export interface Failure {
  message: string;
  /** HTTP status, when the backend reported a structured error. */
  status?: number;
  /** Provider's own error type, e.g. `invalid_request_error`. */
  type?: string;
}

/** Unwrap a JSON error envelope; plain text passes through. */
export function parseFailure(raw: string | null | undefined): Failure {
  const text = (raw ?? "").trim();
  try {
    const parsed = JSON.parse(text);
    const inner = parsed?.error?.message ?? parsed?.message;
    return {
      message: typeof inner === "string" && inner.trim() ? inner : text,
      status: typeof parsed?.status === "number" ? parsed.status : undefined,
      type: typeof parsed?.error?.type === "string" ? parsed.error.type : undefined,
    };
  } catch {
    return { message: text };
  }
}

/** Transient enough for the backend to retry in place. */
export function isRetryable(text: string | null | undefined): boolean {
  const t = text?.trim();
  return !!t && RETRYABLE.some((p) => p.test(t));
}

function scopeOfStatus(status: number, message: string): FailoverScope | undefined {
  if (status === 404) return "model";
  if (status === 401 || status === 403 || status === 408 || status === 429 || status >= 500) return "provider";
  if (MODEL_SCOPED.some((p) => p.test(message))) return "model";
  return undefined;
}

/**
 * How far the chain should skip. `blank` is what an empty or opaque message
 * implies: a run that reported nothing points at the provider, a structured
 * error that merely lacks a message does not.
 */
export function scopeOf(failure: Failure, blank?: FailoverScope): FailoverScope | undefined {
  const t = failure.message.trim();
  // A status is authoritative even when the message is empty — the prose that
  // accompanies a 429 or 529 is routinely unhelpful.
  if (failure.status !== undefined) return scopeOfStatus(failure.status, t);
  if (!t || t.toLowerCase() === "unknown error") return blank;
  if (MODEL_SCOPED.some((p) => p.test(t))) return "model";
  if (PROVIDER_SCOPED.some((p) => p.test(t))) return "provider";
  return undefined;
}
