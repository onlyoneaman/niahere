import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import {
  getConfiguredChannelNames,
  reconcileChannels,
  registerAllChannels,
  startChannels,
  stopChannels,
} from "../../src/channels";
import {
  getFactories,
  clearStarted,
  getChannel,
  getStarted,
  registerChannel,
  trackStarted,
} from "../../src/channels/registry";
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

describe("reconcileChannels", () => {
  beforeEach(() => {
    clearStarted();
  });
  afterEach(() => {
    clearStarted();
  });

  test("is a no-op when running channels match configuration", async () => {
    writeFileSync(`${TEST_DIR}/config.yaml`, ["channels:", "  telegram:", "    bot_token: test-token"].join("\n"));
    resetConfig();

    let stopped = false;
    const telegram: Channel = {
      name: "telegram",
      start: async () => {},
      stop: async () => {
        stopped = true;
      },
      deliver: async () => {},
    };
    trackStarted(telegram);

    const result = await reconcileChannels();

    expect(result.started).toEqual([]);
    expect(stopped).toBe(false);
    expect(getStarted().map((c) => c.name)).toEqual(["telegram"]);
  });

  test("stops channels that are running but no longer configured", async () => {
    // No channels configured — wanted set is empty.
    writeFileSync(`${TEST_DIR}/config.yaml`, "channels:\n  enabled: true\n");
    resetConfig();

    let stopped = false;
    const orphan: Channel = {
      name: "telegram",
      start: async () => {},
      stop: async () => {
        stopped = true;
      },
      deliver: async () => {},
    };
    trackStarted(orphan);

    const result = await reconcileChannels();

    expect(stopped).toBe(true);
    expect(result.started).toEqual([]);
    expect(getStarted()).toEqual([]);
  });
});

// Registers persistent mock factories, so keep this block last in the file.
describe("startChannels name filter", () => {
  test("starts only the named channels, leaving others untouched", async () => {
    clearStarted();
    let startedA = false;
    let startedB = false;
    registerChannel(() => ({
      name: "mock-a",
      start: async () => {
        startedA = true;
      },
      stop: async () => {},
      deliver: async () => {},
    }));
    registerChannel(() => ({
      name: "mock-b",
      start: async () => {
        startedB = true;
      },
      stop: async () => {},
      deliver: async () => {},
    }));

    const result = await startChannels(["mock-a"]);

    expect(startedA).toBe(true);
    expect(startedB).toBe(false);
    expect(result.started.map((c) => c.name)).toEqual(["mock-a"]);
    clearStarted();
  });
});
