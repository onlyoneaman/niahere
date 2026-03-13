import { describe, expect, test } from "bun:test";
import { parseDuration } from "../../src/utils/duration";

describe("parseDuration", () => {
  test("parses seconds", () => {
    expect(parseDuration("30s")).toBe(30_000);
  });

  test("parses minutes", () => {
    expect(parseDuration("5m")).toBe(300_000);
  });

  test("parses hours", () => {
    expect(parseDuration("2h")).toBe(7_200_000);
  });

  test("parses days", () => {
    expect(parseDuration("1d")).toBe(86_400_000);
  });

  test("throws on invalid format", () => {
    expect(() => parseDuration("abc")).toThrow();
    expect(() => parseDuration("")).toThrow();
    expect(() => parseDuration("5x")).toThrow();
  });

  test("parses compound durations", () => {
    expect(parseDuration("1h30m")).toBe(5_400_000);
  });
});
