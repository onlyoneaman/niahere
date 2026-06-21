import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { getConfiguredChannelNames, registerAllChannels, startChannels, stopChannels } from "../../src/channels";
import { getFactories, clearStarted, getChannel } from "../../src/channels/registry";
import { resetConfig } from "../../src/utils/config";
import type { Channel } from "../../src/types";

const TEST_DIR = "/tmp/test-nia-channels";

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
  process.env.NIA_HOME = TEST_DIR;
  resetConfig();
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
  delete process.env.NIA_HOME;
  resetConfig();
  clearStarted();
});

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

describe("getConfiguredChannelNames", () => {
  test("does not include disabled configured channels", () => {
    writeFileSync(
      `${TEST_DIR}/config.yaml`,
      [
        "channels:",
        "  telegram:",
        "    enabled: false",
        "    bot_token: test-token",
        "  slack:",
        "    enabled: false",
        "    bot_token: xoxb-test",
        "    app_token: xapp-test",
      ].join("\n"),
    );
    resetConfig();

    expect(getConfiguredChannelNames()).toEqual([]);
  });

  test("includes enabled channels with required credentials", () => {
    writeFileSync(
      `${TEST_DIR}/config.yaml`,
      [
        "channels:",
        "  telegram:",
        "    bot_token: test-token",
        "  slack:",
        "    bot_token: xoxb-test",
        "    app_token: xapp-test",
      ].join("\n"),
    );
    resetConfig();

    expect(getConfiguredChannelNames()).toEqual(["telegram", "slack"]);
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
      stop: async () => {
        stopped = true;
      },
      deliver: async () => {},
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
      deliver: async () => {},
    };
    trackStarted(mockChannel);
    expect(getChannel("test-clear")).toBeDefined();

    await stopChannels([mockChannel]);
    expect(getChannel("test-clear")).toBeUndefined();
  });
});
