import { describe, expect, test, beforeEach } from "bun:test";
import { registerChannel, getFactories, trackStarted, getChannel, clearStarted } from "../../src/channels/registry";
import type { Channel } from "../../src/types";

function makeChannel(name: string): Channel {
  return {
    name,
    start: async () => {},
    stop: async () => {},
  };
}

describe("channel registry", () => {
  beforeEach(() => {
    clearStarted();
  });

  test("registerChannel adds a factory", () => {
    const before = getFactories().length;
    registerChannel(() => makeChannel("test"));
    expect(getFactories().length).toBe(before + 1);
  });

  test("getFactories returns registered factories", () => {
    const factory = () => makeChannel("test");
    registerChannel(factory);
    const factories = getFactories();
    expect(factories.length).toBeGreaterThan(0);
  });

  test("trackStarted and getChannel", () => {
    const ch = makeChannel("mybot");
    trackStarted(ch);
    expect(getChannel("mybot")).toBe(ch);
  });

  test("getChannel returns undefined for unknown", () => {
    expect(getChannel("nonexistent")).toBeUndefined();
  });

  test("clearStarted removes all tracked channels", () => {
    trackStarted(makeChannel("a"));
    trackStarted(makeChannel("b"));
    clearStarted();
    expect(getChannel("a")).toBeUndefined();
    expect(getChannel("b")).toBeUndefined();
  });
});
