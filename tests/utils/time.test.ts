import { describe, expect, test } from "bun:test";
import { formatPromptDate, formatPromptDateTime } from "../../src/utils/time";

describe("formatPromptDate", () => {
  test("includes weekday and configured timezone for prompt context", () => {
    const date = new Date("2026-04-21T21:30:00Z");

    expect(formatPromptDate(date, "Asia/Calcutta")).toBe("Wednesday, April 22, 2026 (Asia/Calcutta)");
  });

  test("uses the supplied timezone when computing the calendar day", () => {
    const date = new Date("2026-04-21T21:30:00Z");

    expect(formatPromptDate(date, "America/New_York")).toBe("Tuesday, April 21, 2026 (America/New_York)");
  });
});

describe("formatPromptDateTime", () => {
  test("includes weekday, date, time, offset, and timezone", () => {
    const date = new Date("2026-04-21T21:30:00Z");
    const formatted = formatPromptDateTime(date, "Asia/Calcutta");

    expect(formatted).toContain("Wednesday, April 22, 2026");
    expect(formatted).toContain("3:00:00 AM");
    expect(formatted).toContain("GMT+5:30");
    expect(formatted).toContain("(Asia/Calcutta)");
  });
});
