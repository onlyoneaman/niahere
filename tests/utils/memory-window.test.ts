import { describe, expect, test } from "bun:test";
import { splitMemory, searchMemoryText, MEMORY_BUDGET_BYTES } from "../../src/utils/memory-window";

const doc = `# Memory

- a preamble bullet

## Personal
- owner drinks too much coffee

## Nia Architecture
- the daemon runs under launchd

## Promoted 2026-04-16
- oldest promoted fact about penguins

## Promoted 2026-05-20
- middling fact about otters

## Promoted 2026-08-18
- newest fact about narwhals
`;

describe("splitMemory", () => {
  test("always keeps curated topical sections, however old", () => {
    // These are hand-organised, not an append log. Dropping them would lose
    // the durable facts and keep the trivia.
    const { loaded } = splitMemory(doc, 1);
    expect(loaded).toContain("## Personal");
    expect(loaded).toContain("## Nia Architecture");
    expect(loaded).toContain("a preamble bullet");
  });

  test("keeps the newest dated sections and defers the older ones", () => {
    const { loaded, deferred } = splitMemory(doc, 1);
    expect(loaded).toContain("narwhals");
    expect(deferred).toContain("penguins");
    expect(deferred).toContain("otters");
    expect(loaded).not.toContain("penguins");
  });

  test("defers nothing when everything fits", () => {
    const { deferred, deferredSections } = splitMemory(doc, 10_000);
    expect(deferred).toBe("");
    expect(deferredSections).toBe(0);
  });

  test("tells the model the rest exists — otherwise this is amnesia, not disclosure", () => {
    const { pointer } = splitMemory(doc, 1);
    expect(pointer).toContain("search_memory");
    expect(pointer).toMatch(/\d+/);
  });

  test("no pointer when nothing was withheld", () => {
    expect(splitMemory(doc, 10_000).pointer).toBe("");
  });

  test("a file with no dated sections is loaded whole", () => {
    const flat = "# Memory\n\n## Personal\n- one\n- two\n";
    const { loaded, deferred } = splitMemory(flat, 1);
    expect(deferred).toBe("");
    expect(loaded).toContain("two");
  });

  test("the default budget is smaller than the file it was chosen for", () => {
    // memory.md was 37.7 KB and 54% of the system prompt when this was written.
    expect(MEMORY_BUDGET_BYTES).toBeLessThan(37_715);
  });
});

describe("searchMemoryText", () => {
  test("finds an entry and names the section it came from", () => {
    const hits = searchMemoryText(doc, "narwhal");
    expect(hits).toHaveLength(1);
    expect(hits[0]!.section).toBe("Promoted 2026-08-18");
    expect(hits[0]!.entry).toContain("narwhals");
  });

  test("is case-insensitive and matches partial words", () => {
    expect(searchMemoryText(doc, "PENGUIN")).toHaveLength(1);
  });

  test("searches deferred and loaded content alike — the model should not have to care", () => {
    expect(searchMemoryText(doc, "coffee")).toHaveLength(1);
  });

  test("no match is an empty list, not a guess", () => {
    // The benchmark scout cited found files beat vectors on abstention; keep that.
    expect(searchMemoryText(doc, "quantum tunnelling")).toEqual([]);
  });

  test("respects a limit", () => {
    expect(searchMemoryText(doc, "-", 2)).toHaveLength(2);
  });
});
