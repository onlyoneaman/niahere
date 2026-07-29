import { describe, expect, test } from "bun:test";
import { isRetryable, scopeOf, parseFailure } from "../../src/agent/failure";

describe("isRetryable", () => {
  test("flags transient upstream failures", () => {
    expect(isRetryable("529 overloaded")).toBe(true);
    expect(isRetryable("rate limit exceeded")).toBe(true);
  });

  test("does not flag a permanent failure", () => {
    expect(isRetryable("400 bad request")).toBe(false);
  });
});

describe("parseFailure", () => {
  // Verified against real codex 0.145.0 output.
  const envelope =
    '{"type":"error","status":400,"error":{"type":"invalid_request_error","message":"The \'claude-sonnet-5\' model is not supported when using Codex with a ChatGPT account."}}';

  test("unwraps a JSON envelope to its message, status and type", () => {
    const f = parseFailure(envelope);
    expect(f.message).toBe("The 'claude-sonnet-5' model is not supported when using Codex with a ChatGPT account.");
    expect(f.status).toBe(400);
    expect(f.type).toBe("invalid_request_error");
  });

  test("passes plain text through untouched", () => {
    const f = parseFailure("the tests did not pass");
    expect(f.message).toBe("the tests did not pass");
    expect(f.status).toBeUndefined();
  });
});

describe("scopeOf — structured status wins over prose", () => {
  test("auth statuses are provider-scoped", () => {
    expect(scopeOf(parseFailure('{"status":401,"error":{"message":"nope"}}'))).toBe("provider");
    expect(scopeOf(parseFailure('{"status":403,"error":{"message":"nope"}}'))).toBe("provider");
  });

  test("a usage limit is provider-scoped — the account, not the model", () => {
    expect(scopeOf(parseFailure('{"status":429,"error":{"message":"usage limit reached"}}'))).toBe("provider");
  });

  test("upstream 5xx is provider-scoped", () => {
    expect(scopeOf(parseFailure('{"status":503,"error":{"message":"unavailable"}}'))).toBe("provider");
  });

  test("a rejected model is model-scoped whatever the status", () => {
    expect(scopeOf(parseFailure('{"status":404,"error":{"message":"no such thing"}}'))).toBe("model");
    expect(scopeOf(parseFailure('{"status":400,"error":{"message":"The \'x\' model is not supported"}}'))).toBe("model");
  });

  test("a plain bad request is a real failure, not a failover", () => {
    expect(scopeOf(parseFailure('{"status":400,"error":{"message":"your prompt was malformed"}}'))).toBeUndefined();
  });
});

describe("scopeOf — prose fallback", () => {
  const s = (text: string) => scopeOf(parseFailure(text));

  test("an empty or opaque message takes the caller's blank scope", () => {
    expect(scopeOf(parseFailure(""), "provider")).toBe("provider");
    expect(scopeOf(parseFailure("unknown error"), "provider")).toBe("provider");
  });

  test("a structured failure with no message is not an outage", () => {
    expect(scopeOf(parseFailure(""))).toBeUndefined();
  });

  test("real auth and network failures are provider-scoped", () => {
    expect(s("Failed to authenticate: OAuth session expired and could not be refreshed")).toBe("provider");
    expect(s("Not logged in. Run `codex login` to continue.")).toBe("provider");
    expect(s("error sending request: ECONNREFUSED")).toBe("provider");
    expect(s("failed to refresh available models: timeout waiting for child process")).toBe("provider");
    expect(s("TokenRefreshFailed")).toBe("provider");
  });

  test("a context window overflow is model-scoped — a roomier model may cope", () => {
    expect(s("ContextWindowExceeded")).toBe("model");
    expect(s("context window exceeded for this request")).toBe("model");
  });

  test("a genuine task failure carries no scope so the chain stops", () => {
    expect(s("error: no such file or directory (os error 2)")).toBeUndefined();
    expect(s("Not inside a trusted directory and --skip-git-repo-check was not specified.")).toBeUndefined();
  });

  // These are why the prose patterns were narrowed: the codex binary and the
  // agent's own output both talk about logins, credentials and API keys.
  test("does not mistake talk about auth for an auth failure", () => {
    expect(s("API key configured (run codex login to use ChatGPT)")).toBeUndefined();
    expect(s("I updated the login page and added credentials validation to the form")).toBeUndefined();
    expect(s("Could not read the api key from .env — the repo does not check it in")).toBeUndefined();
    expect(s("Renamed loginHandler to sessionHandler across 3 files")).toBeUndefined();
  });
});
