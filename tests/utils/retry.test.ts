import { describe, expect, test } from "bun:test";
import { isCliProviderDownError, isProviderDownError, isRetryableApiError } from "../../src/utils/retry";

describe("isProviderDownError", () => {
  test("treats blank and opaque failures as provider down", () => {
    expect(isProviderDownError("")).toBe(true);
    expect(isProviderDownError("   ")).toBe(true);
    expect(isProviderDownError(null)).toBe(true);
    expect(isProviderDownError("unknown error")).toBe(true);
  });

  test("treats a specific, surfaceable failure as a real error", () => {
    expect(isProviderDownError("file not found: config.yaml")).toBe(false);
  });
});

describe("isCliProviderDownError", () => {
  test("classifies an expired CLI auth session as provider down", () => {
    expect(isCliProviderDownError("Failed to authenticate: OAuth session expired and could not be refreshed")).toBe(
      true,
    );
  });

  test("classifies missing or invalid credentials as provider down", () => {
    expect(isCliProviderDownError("Not logged in. Run `codex login` to continue.")).toBe(true);
    expect(isCliProviderDownError("error: 401 Unauthorized")).toBe(true);
    expect(isCliProviderDownError("invalid api key provided")).toBe(true);
  });

  test("classifies an unreachable provider as provider down", () => {
    expect(isCliProviderDownError("error sending request: ECONNREFUSED")).toBe(true);
    expect(isCliProviderDownError("failed to refresh available models: timeout waiting for child process")).toBe(true);
  });

  test("classifies a blank failure as provider down", () => {
    expect(isCliProviderDownError("")).toBe(true);
    expect(isCliProviderDownError(null)).toBe(true);
  });

  test("leaves a genuine task failure as a real error so it is not retried on another backend", () => {
    expect(isCliProviderDownError("error: no such file or directory (os error 2)")).toBe(false);
    expect(isCliProviderDownError("Not inside a trusted directory and --skip-git-repo-check was not specified.")).toBe(
      false,
    );
  });
});

describe("isRetryableApiError", () => {
  test("flags transient upstream failures", () => {
    expect(isRetryableApiError("529 overloaded")).toBe(true);
    expect(isRetryableApiError("rate limit exceeded")).toBe(true);
  });

  test("does not flag a permanent failure", () => {
    expect(isRetryableApiError("400 bad request")).toBe(false);
  });
});
