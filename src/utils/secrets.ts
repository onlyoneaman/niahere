/**
 * Credential detection for anything about to be written into durable memory.
 *
 * `memory.md` and `rules.md` load into every session's system prompt, so a key
 * that lands there has permanent, maximum-exposure blast radius — it is handed
 * to every model, on every backend, on every turn, until someone notices and
 * edits the file. `addMemory()` checked length and line count; `addRule()`
 * validated nothing at all and appended straight to disk.
 *
 * Patterns are anchored on the issuer's own format rather than on words like
 * "key" or "token", so discussing credentials stays possible and pasting one
 * does not.
 */

export interface SecretPattern {
  name: string;
  pattern: RegExp;
}

export const SECRET_PATTERNS: SecretPattern[] = [
  { name: "Anthropic API key", pattern: /\bsk-ant-api\d{2}-[A-Za-z0-9_-]{20,}/ },
  { name: "Claude OAuth token", pattern: /\bsk-ant-oat\d{2}-[A-Za-z0-9_-]{20,}/ },
  { name: "OpenAI key", pattern: /\bsk-(?:proj|svcacct|admin)?-?[A-Za-z0-9_-]{32,}/ },
  { name: "Slack bot/user token", pattern: /\bxox[abpsr]-[A-Za-z0-9-]{10,}/ },
  { name: "Slack app token", pattern: /\bxapp-\d-[A-Za-z0-9-]{10,}/ },
  { name: "GitHub token", pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}/ },
  { name: "AWS access key id", pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/ },
  { name: "database URL with password", pattern: /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:[^\s@/]+@/i },
  { name: "bearer credential", pattern: /\bBearer\s+[A-Za-z0-9._~+/-]{20,}/ },
  { name: "private key block", pattern: /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/ },
  { name: "Google API key", pattern: /\bAIza[A-Za-z0-9_-]{30,}/ },
  { name: "Twilio auth", pattern: /\bSK[a-f0-9]{32}\b/ },
];

/** The name of the first credential found, or null. */
export function findSecret(text: string): string | null {
  for (const { name, pattern } of SECRET_PATTERNS) {
    if (pattern.test(text)) return name;
  }
  return null;
}
