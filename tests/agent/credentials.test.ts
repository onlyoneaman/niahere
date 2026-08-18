import { describe, expect, test } from "bun:test";
import { resolveClaudeCredential, credentialEnv } from "../../src/agent/credentials";

const cfg = (over: Record<string, unknown> = {}) =>
  ({ anthropic_oauth_token: null, anthropic_api_key: null, ...over }) as never;
const noEnv = () => undefined;

describe("resolveClaudeCredential", () => {
  test("a configured oauth token wins — it is the one Nia controls", () => {
    const c = resolveClaudeCredential(cfg({ anthropic_oauth_token: "sk-ant-oat-x" }), noEnv);
    expect(c.kind).toBe("oauth_token");
    expect(c.envVar).toBe("CLAUDE_CODE_OAUTH_TOKEN");
    expect(c.billing).toBe("subscription");
  });

  test("an api key is accepted but flagged as metered — it changes what you pay", () => {
    // Nia peaked at $552/week. On the API that is an invoice, not a plan.
    const c = resolveClaudeCredential(cfg({ anthropic_api_key: "sk-ant-api-x" }), noEnv);
    expect(c.kind).toBe("api_key");
    expect(c.billing).toBe("metered");
  });

  test("the oauth token beats an api key when both are set", () => {
    const c = resolveClaudeCredential(
      cfg({ anthropic_oauth_token: "sk-ant-oat-x", anthropic_api_key: "sk-ant-api-x" }),
      noEnv,
    );
    expect(c.kind).toBe("oauth_token");
  });

  test("config beats the ambient environment, so the daemon is not at the shell's mercy", () => {
    const c = resolveClaudeCredential(cfg({ anthropic_oauth_token: "from-config" }), (k) =>
      k === "CLAUDE_CODE_OAUTH_TOKEN" ? "from-env" : undefined,
    );
    expect(c.value).toBe("from-config");
  });

  test("the environment is used when config says nothing", () => {
    const c = resolveClaudeCredential(cfg(), (k) => (k === "CLAUDE_CODE_OAUTH_TOKEN" ? "from-env" : undefined));
    expect(c.kind).toBe("oauth_token");
    expect(c.value).toBe("from-env");
  });

  test("with nothing configured it falls back to Claude Code's own login", () => {
    // The status quo — and the thing that coupled Nia's uptime to a human
    // opening a terminal on the same box.
    const c = resolveClaudeCredential(cfg(), noEnv);
    expect(c.kind).toBe("claude_code_login");
    expect(c.value).toBeUndefined();
    expect(c.billing).toBe("subscription");
  });

  test("blank strings are not credentials", () => {
    expect(resolveClaudeCredential(cfg({ anthropic_oauth_token: "   " }), noEnv).kind).toBe("claude_code_login");
  });
});

describe("credentialEnv", () => {
  test("keeps the rest of the environment — the CLI still needs PATH and HOME", () => {
    const base = { PATH: "/usr/bin", HOME: "/home/x" };
    const env = credentialEnv({ kind: "oauth_token", envVar: "CLAUDE_CODE_OAUTH_TOKEN", value: "tok", billing: "subscription" }, base);
    expect(env.PATH).toBe("/usr/bin");
    expect(env.HOME).toBe("/home/x");
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe("tok");
  });

  test("an api key is passed under its own variable", () => {
    const env = credentialEnv({ kind: "api_key", envVar: "ANTHROPIC_API_KEY", value: "k", billing: "metered" }, {});
    expect(env.ANTHROPIC_API_KEY).toBe("k");
  });

  test("falling back to Claude Code's login changes nothing about the environment", () => {
    const base = { PATH: "/usr/bin" };
    expect(credentialEnv({ kind: "claude_code_login", billing: "subscription" }, base)).toEqual(base);
  });

  test("never leaves a stale token behind when config no longer sets one", () => {
    // Otherwise a removed credential would keep working until a restart, and
    // nobody would know which one was actually in use.
    const base = { CLAUDE_CODE_OAUTH_TOKEN: "old", ANTHROPIC_API_KEY: "older", PATH: "/usr/bin" };
    const env = credentialEnv({ kind: "claude_code_login", billing: "subscription" }, base);
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.PATH).toBe("/usr/bin");
  });
});
