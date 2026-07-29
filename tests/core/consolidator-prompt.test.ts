import { describe, expect, test } from "bun:test";
import { buildConsolidationPrompt } from "../../src/core/consolidator";

const prompt = buildConsolidationPrompt("[user] (2026-07-29): hi\n\n[nia] (2026-07-29): hello", "test");

describe("consolidation prompt", () => {
  test("renders without breaking out of the template", () => {
    expect(prompt).toContain("Job: memory-consolidation");
    expect(prompt).toContain("[user] (2026-07-29): hi");
    expect(prompt).not.toContain("undefined");
  });

  test("keeps the two-stage write restriction", () => {
    expect(prompt).toContain("staging.md");
    expect(prompt).toContain("Do NOT write to");
    expect(prompt).toContain("memory-promoter");
  });

  test("bars are durability-based, not mere relevance", () => {
    expect(prompt).toContain("would this still be true and useful in 30 days");
  });

  test("names what must never be staged", () => {
    for (const excluded of ["Transient state", "One-off events", "Derivable facts", "Task chatter", "Restatements"]) {
      expect(prompt).toContain(excluded);
    }
  });

  test("still tells it not to starve — recall is the older failure mode", () => {
    expect(prompt).toContain("don't be so conservative that the");
    expect(prompt).toContain("your bar is too high");
  });

  test("dates the entry format so stale candidates are visible", () => {
    const today = new Date().toISOString().slice(0, 10);
    expect(prompt).toContain(`:: ${today} → ${today}`);
  });
});
