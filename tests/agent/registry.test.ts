import { describe, expect, test } from "bun:test";
import { getBackend } from "../../src/agent";

describe("getBackend", () => {
  test("returns the claude backend by default", () => {
    expect(getBackend().name).toBe("claude");
  });
  test("returns a stable singleton", () => {
    expect(getBackend()).toBe(getBackend());
  });
});
