import { describe, expect, test } from "bun:test";

describe("finalizer", () => {
  test("exports expected functions", async () => {
    const mod = await import("../../src/core/finalizer");
    expect(typeof mod.finalizeSession).toBe("function");
    expect(typeof mod.cancelPending).toBe("function");
    expect(typeof mod.processPending).toBe("function");
    expect(typeof mod.cleanupOldRequests).toBe("function");
  });
});
