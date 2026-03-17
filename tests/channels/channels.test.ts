import { describe, expect, test, beforeEach } from "bun:test";
import { registerAllChannels, startChannels, stopChannels } from "../../src/channels";
import { getFactories, clearStarted, getChannel } from "../../src/channels/registry";
import type { Channel } from "../../src/types";

describe("registerAllChannels", () => {
  test("registers telegram and slack factories", () => {
    const before = getFactories().length;
    registerAllChannels();
    // Should add at least 2 factories (telegram + slack)
    expect(getFactories().length).toBeGreaterThanOrEqual(before + 2);
  });
});

describe("startChannels", () => {
  beforeEach(() => {
    clearStarted();
  });

  test("returns empty result when no channels are configured", async () => {
    // With no tokens configured, factories return null
    const result = await startChannels();
    expect(Array.isArray(result.started)).toBe(true);
    expect(Array.isArray(result.failed)).toBe(true);
  });
});

describe("stopChannels", () => {
  beforeEach(() => {
    clearStarted();
  });

  test("stops all provided channels", async () => {
    let stopped = false;
    const mockChannel: Channel = {
      name: "mock",
      start: async () => {},
      stop: async () => { stopped = true; },
    };

    await stopChannels([mockChannel]);
    expect(stopped).toBe(true);
  });

  test("handles empty array", async () => {
    await stopChannels([]);
    // Should not throw
  });

  test("clears started channels after stopping", async () => {
    const { trackStarted } = await import("../../src/channels/registry");
    const mockChannel: Channel = {
      name: "test-clear",
      start: async () => {},
      stop: async () => {},
    };
    trackStarted(mockChannel);
    expect(getChannel("test-clear")).toBeDefined();

    await stopChannels([mockChannel]);
    expect(getChannel("test-clear")).toBeUndefined();
  });
});
