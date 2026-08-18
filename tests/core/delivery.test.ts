import { describe, expect, test } from "bun:test";
import { awaitsDelivery, initialDeliveryStatus, auditDelivery, STUCK_AFTER_MS } from "../../src/core/delivery";

describe("awaitsDelivery", () => {
  test("channels that hand a message to something outside this process", () => {
    for (const c of ["slack", "telegram", "sms", "whatsapp", "phone"]) {
      expect(awaitsDelivery(c)).toBe(true);
    }
  });

  test("a reply printed to stdout has nothing to confirm", () => {
    // `nia run` and the REPL write the answer to the terminal and are done.
    // Marking those pending left 23 rows stuck on the mini, oldest from March.
    for (const c of ["terminal", "system", "test"]) {
      expect(awaitsDelivery(c)).toBe(false);
    }
  });

  test("an unknown channel is assumed to deliver — better a false alarm than a lost message", () => {
    expect(awaitsDelivery("some-future-channel")).toBe(true);
  });
});

describe("initialDeliveryStatus", () => {
  test("only a real delivery starts as pending", () => {
    expect(initialDeliveryStatus("slack")).toBe("pending");
    expect(initialDeliveryStatus("terminal")).toBe("sent");
    expect(initialDeliveryStatus("system")).toBe("sent");
  });
});

describe("auditDelivery", () => {
  const NOW = Date.parse("2026-08-18T12:00:00Z");
  const ago = (ms: number) => new Date(NOW - ms).toISOString();

  test("says nothing when every message landed", () => {
    expect(auditDelivery([], NOW)).toEqual({ name: "delivery", status: "ok", detail: "no messages awaiting confirmation" });
  });

  test("a send in flight is not a problem", () => {
    const c = auditDelivery([{ room: "slack-dm-U1-8", createdAt: ago(5_000) }], NOW);
    expect(c.status).toBe("ok");
  });

  test("a send that never confirmed is worth reporting", () => {
    const c = auditDelivery([{ room: "slack-dm-U1-8", createdAt: ago(STUCK_AFTER_MS + 60_000) }], NOW);
    expect(c.status).toBe("warn");
    expect(c.detail).toContain("1");
    expect(c.detail).toContain("slack-dm-U1-8");
  });

  test("counts them and names the oldest, without listing thirty rooms", () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({
      room: `slack-dm-U1-${i}`,
      createdAt: ago(STUCK_AFTER_MS + (i + 1) * 60_000),
    }));
    const c = auditDelivery(rows, NOW);
    expect(c.detail).toContain("12");
    expect(c.detail.length).toBeLessThan(200);
  });
});

describe("the health check must let the CLI exit", () => {
  // 0.5.9 read pending rows with a bare getSql(). Every check printed, then
  // `nia health` hung forever on an open connection nobody closed.
  test("the delivery check goes through withDb", async () => {
    const src = await Bun.file("src/core/health.ts").text();
    const block = src.slice(src.indexOf("auditDelivery("), src.indexOf("auditDelivery(") + 400);
    expect(src).toContain("withDb");
    expect(block).not.toMatch(/getSql\(\)/);
  });
});
