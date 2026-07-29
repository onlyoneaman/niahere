import { describe, expect, test } from "bun:test";
import { asError, errMsg, ignore } from "../../src/utils/errors";

describe("errMsg", () => {
  test("takes the message off an Error", () => {
    expect(errMsg(new Error("boom"))).toBe("boom");
  });

  test("stringifies anything else", () => {
    expect(errMsg("plain string")).toBe("plain string");
    expect(errMsg(42)).toBe("42");
    expect(errMsg(null)).toBe("null");
  });
});

describe("ignore", () => {
  test("resolves when the work succeeds", async () => {
    await expect(ignore(Promise.resolve("fine"), "doing a thing")).resolves.toBeUndefined();
  });

  test("does not reject when the work fails", async () => {
    await expect(ignore(Promise.reject(new Error("nope")), "doing a thing")).resolves.toBeUndefined();
  });

  test("records the failure instead of discarding it", async () => {
    const seen: { context: string; err: string }[] = [];
    await ignore(Promise.reject(new Error("disk full")), "pruning cache", (context, err) =>
      seen.push({ context, err }),
    );
    expect(seen).toEqual([{ context: "pruning cache", err: "disk full" }]);
  });

  test("stays quiet on success", async () => {
    const seen: unknown[] = [];
    await ignore(Promise.resolve(1), "ok path", (...a) => seen.push(a));
    expect(seen).toHaveLength(0);
  });
});

describe("asError", () => {
  test("keeps the original Error so the stack survives a rethrow", () => {
    const original = new Error("boom");
    expect(asError(original)).toBe(original);
  });

  test("wraps a non-Error in one", () => {
    const wrapped = asError("just a string");
    expect(wrapped).toBeInstanceOf(Error);
    expect(wrapped.message).toBe("just a string");
  });
});
