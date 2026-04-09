import { describe, expect, test } from "bun:test";

describe("finalizer", () => {
  describe("role detection", () => {
    test("defaults to cli role", async () => {
      const { getRole } = await import("../../src/core/finalizer");
      expect(getRole()).toBe("cli");
    });

    test("setRole changes role", async () => {
      const { getRole, setRole } = await import("../../src/core/finalizer");
      setRole("daemon");
      expect(getRole()).toBe("daemon");
      setRole("cli"); // reset
    });
  });
});
