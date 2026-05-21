import { describe, expect, test } from "bun:test";
import { Dedup } from "../../../src/channels/twilio/dedup";

describe("twilio/dedup", () => {
  test("first sighting returns false, subsequent return true", () => {
    const d = new Dedup();
    expect(d.check("MSG1")).toBe(false);
    expect(d.check("MSG1")).toBe(true);
    expect(d.check("MSG1")).toBe(true);
  });

  test("distinct IDs are tracked independently", () => {
    const d = new Dedup();
    expect(d.check("A")).toBe(false);
    expect(d.check("B")).toBe(false);
    expect(d.check("A")).toBe(true);
    expect(d.check("B")).toBe(true);
  });

  test("entries expire after ttl", async () => {
    const d = new Dedup(50, 100);
    expect(d.check("X")).toBe(false);
    expect(d.check("X")).toBe(true);
    await new Promise((r) => setTimeout(r, 60));
    expect(d.check("X")).toBe(false);
  });

  test("prunes when over maxEntries", async () => {
    const d = new Dedup(20, 5);
    for (const id of ["A", "B", "C", "D", "E", "F"]) d.check(id);
    // After exceeding cap, the constructor's pruning still leaves the new entries.
    // Wait past ttl, then add — old entries should be gone.
    await new Promise((r) => setTimeout(r, 30));
    d.check("Z");
    expect(d.size()).toBeLessThanOrEqual(5);
  });
});
