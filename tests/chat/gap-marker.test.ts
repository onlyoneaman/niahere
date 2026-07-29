import { describe, expect, test } from "bun:test";
import { GAP_THRESHOLD_MS, gapMarker } from "../../src/chat/gap-marker";

const TZ = "Asia/Calcutta";
const at = (iso: string) => new Date(iso);

/** 09:00 IST on 5 Aug 2026 (IST is UTC+5:30). */
const NOW = at("2026-08-05T03:30:00Z");

describe("gapMarker — when it stays quiet", () => {
  test("no marker on a reply moments later", () => {
    expect(gapMarker(NOW, at("2026-08-05T03:28:00Z"), TZ)).toBeNull();
  });

  test("no marker just under the threshold", () => {
    const justUnder = new Date(NOW.getTime() - (GAP_THRESHOLD_MS - 60_000));
    expect(gapMarker(NOW, justUnder, TZ)).toBeNull();
  });

  test("no marker on the very first message in a room", () => {
    // Nothing to measure against, and the system prompt already carries today's date.
    expect(gapMarker(NOW, null, TZ)).toBeNull();
  });
});

describe("gapMarker — when it fires", () => {
  test("marks a gap past the threshold", () => {
    const marker = gapMarker(NOW, new Date(NOW.getTime() - 3 * 60 * 60 * 1000), TZ);
    expect(marker).toContain("3 hours since the last message");
  });

  test("marks a new day even when the gap is short", () => {
    // 23:55 IST yesterday → 00:10 IST today is 15 minutes, but the date moved.
    const now = at("2026-08-04T18:40:00Z"); // 00:10 IST on the 5th
    const last = at("2026-08-04T18:25:00Z"); // 23:55 IST on the 4th
    const marker = gapMarker(now, last, TZ);
    expect(marker).not.toBeNull();
    expect(marker).toContain("15 minutes since the last message");
  });

  test("uses the configured timezone to decide the day, not UTC", () => {
    // 20:00 UTC on the 4th is already 01:30 IST on the 5th — a new day locally.
    const now = at("2026-08-04T20:00:00Z");
    const last = at("2026-08-04T19:00:00Z"); // 00:30 IST on the 5th — same local day
    expect(gapMarker(now, last, TZ)).toBeNull();
  });
});

describe("gapMarker — how it reads", () => {
  const marker = (hoursAgo: number) => gapMarker(NOW, new Date(NOW.getTime() - hoursAgo * 3600_000), TZ)!;

  test("leads with the current local date and time", () => {
    expect(marker(3)).toMatch(/^\[Wednesday, August 5, 2026/);
  });

  test("is bracketed so it cannot be mistaken for the user's words", () => {
    expect(marker(3).startsWith("[")).toBe(true);
    expect(marker(3).endsWith("]")).toBe(true);
  });

  test("scales the unit to the gap", () => {
    expect(gapMarker(NOW, new Date(NOW.getTime() - 150 * 60_000), TZ)).toContain("2 hours");
    expect(marker(26)).toContain("1 day");
    expect(marker(72)).toContain("3 days");
  });

  test("singular and plural read correctly", () => {
    expect(gapMarker(NOW, new Date(NOW.getTime() - 61 * 60_000), TZ)).toBeNull(); // under threshold
    expect(marker(3)).toContain("3 hours");
    expect(marker(25)).toContain("1 day");
    expect(marker(25)).not.toContain("1 days");
  });
});
