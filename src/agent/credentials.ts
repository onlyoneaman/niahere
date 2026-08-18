import type { Config } from "../types/config";

/**
 * Which Claude credential the daemon should use, and where it came from.
 *
 * Nia used to have no answer to this: it inherited whatever `claude` had last
 * written to `~/.claude/.credentials.json`, refreshed by a human opening a
 * terminal on the same machine. When that stopped, Nia answered as codex for
 * sixteen days and nothing said why. A credential the daemon is handed
 * explicitly is one it can report on, and one that does not lapse because
 * nobody logged in today.
 */

export type CredentialKind = "oauth_token" | "api_key" | "claude_code_login";

export interface ClaudeCredential {
  kind: CredentialKind;
  /** The variable the CLI reads it from. Absent for the inherited login. */
  envVar?: "CLAUDE_CODE_OAUTH_TOKEN" | "ANTHROPIC_API_KEY";
  value?: string;
  /**
   * `subscription` rides the plan. `metered` bills per token — worth saying out
   * loud, because Nia has run $552 in a week and that is an invoice on the API.
   */
  billing: "subscription" | "metered";
}

/** Every variable a credential could occupy, so switching never leaves a stale one behind. */
const TOKEN_VARS = ["CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY"] as const;

const clean = (v: unknown): string | undefined => {
  const s = typeof v === "string" ? v.trim() : "";
  return s.length > 0 ? s : undefined;
};

export type EnvLookup = (key: string) => string | undefined;

/**
 * Config first, then the ambient environment, then Claude Code's own login.
 * Config wins so the daemon is not at the mercy of whatever shell launched it.
 */
export function resolveClaudeCredential(
  config: Pick<Config, "anthropic_oauth_token" | "anthropic_api_key">,
  env: EnvLookup = (k) => process.env[k],
): ClaudeCredential {
  const oauth = clean(config.anthropic_oauth_token) ?? clean(env("CLAUDE_CODE_OAUTH_TOKEN"));
  if (oauth) {
    return { kind: "oauth_token", envVar: "CLAUDE_CODE_OAUTH_TOKEN", value: oauth, billing: "subscription" };
  }
  const key = clean(config.anthropic_api_key) ?? clean(env("ANTHROPIC_API_KEY"));
  if (key) {
    return { kind: "api_key", envVar: "ANTHROPIC_API_KEY", value: key, billing: "metered" };
  }
  return { kind: "claude_code_login", billing: "subscription" };
}

/**
 * The environment for the spawned CLI. The base is passed through — it still
 * needs PATH and HOME — with exactly one credential variable set, and any other
 * cleared so a removed credential stops working immediately rather than at the
 * next restart.
 */
export function credentialEnv(credential: ClaudeCredential, base: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(base)) {
    if ((TOKEN_VARS as readonly string[]).includes(k)) continue;
    env[k] = v;
  }
  if (credential.envVar && credential.value) env[credential.envVar] = credential.value;
  return env;
}

export function describeCredential(credential: ClaudeCredential): string {
  if (credential.kind === "oauth_token") return "configured oauth token (subscription, long-lived)";
  if (credential.kind === "api_key") return "configured API key (metered, billed per token)";
  return "Claude Code's own login (refreshed by whoever last used the CLI here)";
}
