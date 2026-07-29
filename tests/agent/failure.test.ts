import { describe, expect, test } from "bun:test";
import { isRetryable, scopeOf } from "../../src/agent/failure";

describe("isRetryable", () => {
  test("flags transient upstream failures", () => {
    expect(isRetryable("529 overloaded")).toBe(true);
    expect(isRetryable("rate limit exceeded")).toBe(true);
  });

  test("does not flag a permanent failure", () => {
    expect(isRetryable("400 bad request")).toBe(false);
  });
});

describe("scopeOf", () => {
  test("an empty or opaque message takes the caller's blank scope", () => {
    expect(scopeOf("", "provider")).toBe("provider");
    expect(scopeOf(null, "provider")).toBe("provider");
    expect(scopeOf("unknown error", "provider")).toBe("provider");
  });

  test("a structured failure with no message is not an outage", () => {
    expect(scopeOf("")).toBeUndefined();
  });

  test("a rejected model is model-scoped", () => {
    expect(scopeOf("The 'claude-sonnet-5' model is not supported")).toBe("model");
    expect(scopeOf("unknown model: foo")).toBe("model");
  });

  test("auth and network failures are provider-scoped", () => {
    expect(scopeOf("Failed to authenticate: OAuth session expired")).toBe("provider");
    expect(scopeOf("Not logged in. Run `codex login` to continue.")).toBe("provider");
    expect(scopeOf("error: 401 Unauthorized")).toBe("provider");
    expect(scopeOf("error sending request: ECONNREFUSED")).toBe("provider");
  });

  test("a genuine task failure carries no scope so the chain stops", () => {
    expect(scopeOf("error: no such file or directory (os error 2)")).toBeUndefined();
    expect(scopeOf("file not found: config.yaml", "provider")).toBeUndefined();
  });
});
