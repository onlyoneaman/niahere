import { describe, expect, test } from "bun:test";
import { withRetry } from "../../src/utils/retry";

describe("withRetry", () => {
  test("retries until the call succeeds", async () => {
    let attempts = 0;
    const result = await withRetry(async () => {
      attempts++;
      if (attempts < 2) throw new Error("transient");
      return "ok";
    }, 2);
    expect(result).toBe("ok");
    expect(attempts).toBe(2);
  });

  test("rethrows once the retries are spent", async () => {
    let attempts = 0;
    await expect(
      withRetry(async () => {
        attempts++;
        throw new Error("always fails");
      }, 1),
    ).rejects.toThrow("always fails");
    expect(attempts).toBe(2);
  });
});
