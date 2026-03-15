import { describe, expect, test } from "bun:test";
import { maskToken, safeDate, dateSortValue, relativeTime, formatTimeLine } from "../../src/utils/format";

describe("maskToken", () => {
  test("masks token to last 6 chars", () => {
    expect(maskToken("xoxb-1234567890-abcdef")).toBe("...abcdef");
  });

  test("returns empty string for null", () => {
    expect(maskToken(null)).toBe("");
  });

  test("handles short token", () => {
    expect(maskToken("abc")).toBe("...abc");
  });
});

describe("safeDate", () => {
  test("parses valid ISO string", () => {
    const date = safeDate("2026-03-14T10:00:00Z");
    expect(date).toBeInstanceOf(Date);
    expect(date!.getFullYear()).toBe(2026);
  });

  test("returns null for null input", () => {
    expect(safeDate(null)).toBeNull();
  });

  test("returns null for undefined", () => {
    expect(safeDate(undefined)).toBeNull();
  });

  test("returns null for empty string", () => {
    expect(safeDate("")).toBeNull();
  });

  test("returns null for invalid date string", () => {
    expect(safeDate("not-a-date")).toBeNull();
  });
});

describe("dateSortValue", () => {
  test("returns timestamp for valid date", () => {
    const value = dateSortValue("2026-03-14T10:00:00Z");
    expect(value).toBe(new Date("2026-03-14T10:00:00Z").getTime());
  });

  test("returns MAX_SAFE_INTEGER for null", () => {
    expect(dateSortValue(null)).toBe(Number.MAX_SAFE_INTEGER);
  });

  test("returns MAX_SAFE_INTEGER for invalid date", () => {
    expect(dateSortValue("nope")).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe("relativeTime", () => {
  const now = new Date("2026-03-14T12:00:00Z");

  test("shows just now for <5 seconds", () => {
    const date = new Date("2026-03-14T11:59:57Z");
    expect(relativeTime(date, now)).toBe("just now");
  });

  test("shows seconds ago", () => {
    const date = new Date("2026-03-14T11:59:30Z");
    expect(relativeTime(date, now)).toBe("30s ago");
  });

  test("shows minutes ago", () => {
    const date = new Date("2026-03-14T11:55:00Z");
    expect(relativeTime(date, now)).toBe("5m ago");
  });

  test("shows hours and minutes ago", () => {
    const date = new Date("2026-03-14T09:30:00Z");
    expect(relativeTime(date, now)).toBe("2h 30m ago");
  });

  test("shows days ago", () => {
    const date = new Date("2026-03-12T12:00:00Z");
    expect(relativeTime(date, now)).toBe("2d ago");
  });

  test("shows future time with in prefix", () => {
    const date = new Date("2026-03-14T12:05:00Z");
    expect(relativeTime(date, now)).toBe("in 5m");
  });
});

describe("formatTimeLine", () => {
  test("returns formatted string for valid date", () => {
    const result = formatTimeLine("2026-03-14T10:00:00Z");
    expect(result).toContain("ago");
    expect(result).toContain("(");
  });

  test("returns unknown for null", () => {
    expect(formatTimeLine(null)).toBe("unknown");
  });

  test("returns unknown for invalid date", () => {
    expect(formatTimeLine("garbage")).toBe("unknown");
  });
});
