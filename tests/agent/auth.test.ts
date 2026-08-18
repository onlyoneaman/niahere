import { describe, expect, test } from "bun:test";
import { claudeAuthStatus, codexAuthStatus, jwtExpiry, REFRESH_WARN_MS, type AuthReader } from "../../src/agent/auth";

const NOW = Date.parse("2026-08-16T12:00:00Z");
const hours = (n: number) => n * 3_600_000;
const days = (n: number) => n * 86_400_000;

function reader(files: Record<string, string>, env: Record<string, string> = {}): AuthReader {
  return {
    exists: (p) => Object.keys(files).some((f) => p.endsWith(f)),
    read: (p) => files[Object.keys(files).find((f) => p.endsWith(f))!]!,
    env: (k) => env[k],
  };
}

const creds = (over: Record<string, unknown>) =>
  JSON.stringify({
    claudeAiOauth: {
      expiresAt: NOW + hours(4),
      refreshTokenExpiresAt: NOW + days(20),
      subscriptionType: "max",
      ...over,
    },
  });

describe("claudeAuthStatus", () => {
  test("a live token reports how long it has left", () => {
    const s = claudeAuthStatus(NOW, reader({ ".credentials.json": creds({}) }));
    expect(s.state).toBe("ok");
    expect(s.detail).toContain("max");
  });

  test("a lapsed access token is stale, not a failure — it renews on demand", () => {
    // Nia idle overnight legitimately holds one of these. Calling it broken
    // would page the owner every morning.
    const s = claudeAuthStatus(NOW, reader({ ".credentials.json": creds({ expiresAt: NOW - hours(9) }) }));
    expect(s.state).toBe("stale");
    expect(s.detail).toContain("renewable");
  });

  test("an expired refresh token is terminal and says what to do", () => {
    const s = claudeAuthStatus(
      NOW,
      reader({ ".credentials.json": creds({ expiresAt: NOW - days(5), refreshTokenExpiresAt: NOW - days(1) }) }),
    );
    expect(s.state).toBe("expired");
    expect(s.detail).toContain("run `claude`");
  });

  test("a refresh token nearing its end warns before it is too late", () => {
    const s = claudeAuthStatus(
      NOW,
      reader({ ".credentials.json": creds({ refreshTokenExpiresAt: NOW + REFRESH_WARN_MS - hours(1) }) }),
    );
    expect(s.state).toBe("expiring");
  });

  test("an API key has no expiry to worry about", () => {
    expect(claudeAuthStatus(NOW, reader({}, { ANTHROPIC_API_KEY: "sk-x" })).state).toBe("ok");
  });

  test("a missing file is unknown, not broken — macOS may hold it in the keychain", () => {
    const s = claudeAuthStatus(NOW, reader({}));
    expect(s.state).toBe("unknown");
    expect(s.detail).toContain("keychain");
  });

  test("unreadable credentials are unknown rather than a false alarm", () => {
    expect(claudeAuthStatus(NOW, reader({ ".credentials.json": "not json" })).state).toBe("unknown");
  });
});

describe("codexAuthStatus", () => {
  const idToken = (exp: number) =>
    `x.${Buffer.from(JSON.stringify({ exp: Math.floor(exp / 1000) })).toString("base64url")}.y`;

  test("reads expiry from the access token, which is what authenticates", () => {
    const s = codexAuthStatus(
      NOW,
      reader({ "auth.json": JSON.stringify({ auth_mode: "chatgpt", tokens: { access_token: idToken(NOW + hours(3)) } }) }),
    );
    expect(s.state).toBe("ok");
    expect(s.detail).toContain("chatgpt");
  });

  test("ignores a lapsed id_token when the access token is live", () => {
    // The mini's real shape: id_token expired 190h ago, access_token valid for
    // two more days, codex serving perfectly. Reading id_token reported a
    // permanent false alarm on every healthy install.
    const s = codexAuthStatus(
      NOW,
      reader({
        "auth.json": JSON.stringify({
          auth_mode: "chatgpt",
          tokens: { id_token: idToken(NOW - hours(190)), access_token: idToken(NOW + hours(48)) },
        }),
      }),
    );
    expect(s.state).toBe("ok");
  });

  test("a lapsed codex token is stale, same as claude's", () => {
    const s = codexAuthStatus(
      NOW,
      reader({ "auth.json": JSON.stringify({ auth_mode: "chatgpt", tokens: { access_token: idToken(NOW - hours(2)) } }) }),
    );
    expect(s.state).toBe("stale");
  });

  test("an API key needs no expiry", () => {
    expect(codexAuthStatus(NOW, reader({ "auth.json": JSON.stringify({ OPENAI_API_KEY: "sk-x" }) })).state).toBe("ok");
  });

  test("not signed in is unknown", () => {
    expect(codexAuthStatus(NOW, reader({})).state).toBe("unknown");
  });
});

describe("jwtExpiry", () => {
  test("ignores the signature — this is our own stored token, not an untrusted one", () => {
    const t = `h.${Buffer.from(JSON.stringify({ exp: 1800000000 })).toString("base64url")}.notasignature`;
    expect(jwtExpiry(t)).toBe(1800000000000);
  });

  test("junk yields nothing rather than a wrong number", () => {
    expect(jwtExpiry(undefined)).toBeUndefined();
    expect(jwtExpiry("nope")).toBeUndefined();
    expect(jwtExpiry("a.!!!.c")).toBeUndefined();
  });
});

describe("claudeAuthStatus with a credential Nia owns", () => {
  test("a configured oauth token has no expiry to police", () => {
    const s = claudeAuthStatus(NOW, reader({}, { CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat-x" }));
    expect(s.state).toBe("ok");
    expect(s.detail).toContain("no refresh needed");
  });

  test("a configured api key says it is metered, because that is a different bill", () => {
    const s = claudeAuthStatus(NOW, reader({}, { ANTHROPIC_API_KEY: "sk-ant-api-x" }));
    expect(s.state).toBe("ok");
    expect(s.detail).toContain("metered");
  });

  test("an oauth token wins over an api key", () => {
    const s = claudeAuthStatus(NOW, reader({}, { CLAUDE_CODE_OAUTH_TOKEN: "t", ANTHROPIC_API_KEY: "k" }));
    expect(s.detail).toContain("oauth token");
  });

  test("falling back to the CLI's login says so, since that is the fragile case", () => {
    const s = claudeAuthStatus(NOW, reader({ ".credentials.json": creds({}) }));
    expect(s.detail).toContain("renewed only when the CLI is used here");
  });
});

describe("the auth check agrees with the backend about which credential is used", () => {
  test("a token in config.yaml is reported, not the file on disk", async () => {
    // The check used to read only the environment while the backend read config
    // first, so a configured token showed up as "Claude Code login".
    const { resolveClaudeCredential } = await import("../../src/agent/credentials");
    const configured = resolveClaudeCredential(
      { anthropic_oauth_token: "sk-ant-oat-from-config", anthropic_api_key: null } as never,
      () => undefined,
    );
    expect(configured.kind).toBe("oauth_token");
    expect(configured.value).toBe("sk-ant-oat-from-config");
  });
});
