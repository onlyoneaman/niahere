import { describe, expect, test } from "bun:test";
import { CONTEXT_TAIL, MIN_NEW_MESSAGES, planConsolidation } from "../../src/core/consolidator";

describe("planConsolidation — first pass", () => {
  test("a session with a real exchange consolidates", () => {
    expect(planConsolidation(2, 0)).toMatchObject({ run: true, from: 0 });
  });

  test("a session too short to contain anything does not", () => {
    expect(planConsolidation(1, 0).run).toBe(false);
  });

  test("a short session still consolidates — a correction can be two turns", () => {
    // The pipeline starves if brief sessions never qualify.
    expect(planConsolidation(3, 0).run).toBe(true);
  });
});

describe("planConsolidation — re-consolidation", () => {
  test("one new message is not worth another pass", () => {
    expect(planConsolidation(51, 50).run).toBe(false);
  });

  test("a meaningful batch of new turns is", () => {
    expect(planConsolidation(50 + MIN_NEW_MESSAGES, 50).run).toBe(true);
  });

  test("re-reads a little prior context so a learning spanning turns survives", () => {
    const plan = planConsolidation(50 + MIN_NEW_MESSAGES, 50);
    expect(plan.from).toBe(50 - CONTEXT_TAIL);
  });

  test("never rewinds past the start of a short session", () => {
    expect(planConsolidation(2 + MIN_NEW_MESSAGES, 2).from).toBe(0);
  });

  test("nothing new at all is a no-op", () => {
    expect(planConsolidation(50, 50).run).toBe(false);
  });

  test("a watermark ahead of the count (messages deleted) does not run", () => {
    expect(planConsolidation(10, 50).run).toBe(false);
  });
});

describe("planConsolidation — cost", () => {
  test("a long session re-consolidates only the new tail, not the whole window", () => {
    // The old behavior re-sent the last 50 messages on every new message.
    const plan = planConsolidation(240, 230);
    expect(plan.run).toBe(true);
    expect(240 - plan.from).toBeLessThanOrEqual(MIN_NEW_MESSAGES + CONTEXT_TAIL + 5);
  });

  test("a first pass on a very long session is still bounded", () => {
    const plan = planConsolidation(500, 0);
    expect(plan.run).toBe(true);
    expect(plan.from).toBeGreaterThan(0); // capped, not the whole 500
  });
});
