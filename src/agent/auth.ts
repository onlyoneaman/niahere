import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import type { ProviderName } from "./models";

/**
 * Provider sign-in state, read from whatever each CLI stores on disk.
 *
 * The distinction that matters: an *access* token expiring is routine — it
 * lives hours and is renewed on demand, so a daemon idle overnight legitimately
 * holds an expired one. A *refresh* token expiring is terminal: nothing can
 * renew it and the only fix is signing in again.
 *
 * Reporting the first as a failure would cry wolf nightly. Reporting neither is
 * how Nia spent sixteen days answering as codex on a Claude token that expired
 * at 22:42 on a Thursday and told nobody.
 */

export type AuthState = "ok" | "stale" | "expiring" | "expired" | "unknown";

export interface AuthStatus {
  provider: ProviderName;
  state: AuthState;
  detail: string;
  /** When the short-lived access token lapses, ms epoch. */
  accessExpiresAt?: number;
  /** When re-authentication becomes unavoidable, ms epoch. */
  refreshExpiresAt?: number;
}

/** Re-auth this close to being forced is worth saying out loud. */
export const REFRESH_WARN_MS = 3 * 24 * 60 * 60 * 1000;

export interface AuthReader {
  exists: (path: string) => boolean;
  read: (path: string) => string;
  env: (key: string) => string | undefined;
}

const defaultReader: AuthReader = {
  exists: existsSync,
  read: (p) => readFileSync(p, "utf8"),
  env: (k) => process.env[k],
};

export function claudeCredentialsPath(): string {
  return join(homedir(), ".claude", ".credentials.json");
}

export function codexAuthPath(): string {
  return join(process.env.CODEX_HOME || join(homedir(), ".codex"), "auth.json");
}

function ago(ms: number): string {
  const abs = Math.abs(ms);
  const hours = abs / 3_600_000;
  if (hours < 1) return `${Math.round(abs / 60_000)}m`;
  if (hours < 48) return `${hours.toFixed(1)}h`;
  return `${Math.round(hours / 24)}d`;
}

export function claudeAuthStatus(now: number = Date.now(), reader: AuthReader = defaultReader): AuthStatus {
  const base = { provider: "claude" as const };

  // A credential Nia was handed does not lapse because nobody logged in today,
  // so there is no expiry to police — only which one is in play.
  if (reader.env("CLAUDE_CODE_OAUTH_TOKEN")) {
    return { ...base, state: "ok", detail: "configured oauth token (subscription, no refresh needed)" };
  }
  if (reader.env("ANTHROPIC_API_KEY")) {
    return { ...base, state: "ok", detail: "configured API key (metered — billed per token)" };
  }

  const path = claudeCredentialsPath();
  if (!reader.exists(path)) {
    // macOS can keep these in the Keychain instead, which a background daemon
    // must not prompt for. Saying "unknown" beats guessing "broken".
    return { ...base, state: "unknown", detail: "no credentials file (keychain, or not signed in)" };
  }

  let oauth: Record<string, unknown>;
  try {
    oauth = (JSON.parse(reader.read(path)) as Record<string, Record<string, unknown>>).claudeAiOauth ?? {};
  } catch {
    return { ...base, state: "unknown", detail: "credentials file is not readable JSON" };
  }

  const access = typeof oauth.expiresAt === "number" ? oauth.expiresAt : undefined;
  const refresh = typeof oauth.refreshTokenExpiresAt === "number" ? oauth.refreshTokenExpiresAt : undefined;
  const plan = typeof oauth.subscriptionType === "string" ? ` (${oauth.subscriptionType})` : "";
  const status = { ...base, accessExpiresAt: access, refreshExpiresAt: refresh };

  if (refresh !== undefined && refresh <= now) {
    return { ...status, state: "expired", detail: `sign-in expired ${ago(now - refresh)} ago — run \`claude\` to sign in again` };
  }
  if (refresh !== undefined && refresh - now < REFRESH_WARN_MS) {
    return { ...status, state: "expiring", detail: `sign-in must be renewed within ${ago(refresh - now)}${plan}` };
  }
  if (access !== undefined && access <= now) {
    // Routine on its own. It only means something alongside a chain that has
    // stopped using this provider, which the failover check supplies.
    return { ...status, state: "stale", detail: `access token lapsed ${ago(now - access)} ago, renewable${plan}` };
  }
  if (access !== undefined) {
    return {
      ...status,
      state: "ok",
      detail: `Claude Code login, valid for ${ago(access - now)}${plan} — renewed only when the CLI is used here`,
    };
  }
  return { ...status, state: "unknown", detail: "credentials file carries no expiry" };
}

export function codexAuthStatus(now: number = Date.now(), reader: AuthReader = defaultReader): AuthStatus {
  const base = { provider: "codex" as const };
  const path = codexAuthPath();
  if (!reader.exists(path)) return { ...base, state: "unknown", detail: "not signed in" };

  let auth: Record<string, unknown>;
  try {
    auth = JSON.parse(reader.read(path)) as Record<string, unknown>;
  } catch {
    return { ...base, state: "unknown", detail: "auth file is not readable JSON" };
  }

  if (typeof auth.OPENAI_API_KEY === "string" && auth.OPENAI_API_KEY) {
    return { ...base, state: "ok", detail: "API key (no expiry)" };
  }

  const tokens = (auth.tokens ?? {}) as Record<string, unknown>;
  const exp = jwtExpiry(typeof tokens.id_token === "string" ? tokens.id_token : undefined);
  const mode = typeof auth.auth_mode === "string" ? auth.auth_mode : "oauth";
  if (exp === undefined) return { ...base, state: "unknown", detail: `${mode} sign-in, no readable expiry` };
  if (exp <= now) return { ...base, state: "stale", detail: `${mode} token lapsed ${ago(now - exp)} ago, renewable` };
  return { ...base, state: "ok", detail: `${mode}, valid for ${ago(exp - now)}` };
}

/** `exp` out of a JWT payload, in ms. Signature is irrelevant here — we are
 *  reading our own stored token, not trusting one. */
export function jwtExpiry(token: string | undefined): number | undefined {
  const payload = token?.split(".")[1];
  if (!payload) return undefined;
  try {
    const json = JSON.parse(Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
    return typeof json.exp === "number" ? json.exp * 1000 : undefined;
  } catch {
    return undefined;
  }
}

export function authStatusFor(provider: ProviderName, now?: number, reader?: AuthReader): AuthStatus {
  if (provider === "codex") return codexAuthStatus(now, reader);
  if (provider === "claude") return claudeAuthStatus(now, reader);
  return { provider, state: "unknown", detail: "no adapter" };
}
