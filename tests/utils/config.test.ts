import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { loadConfig, resetConfig } from "../../src/utils/config";

const TEST_DIR = "/tmp/test-nia-config";

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
  process.env.NIA_HOME = TEST_DIR;
  resetConfig();
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
  delete process.env.NIA_HOME;
  resetConfig();
});

describe("loadConfig", () => {
  test("loads valid config from config.yaml", () => {
    writeFileSync(
      `${TEST_DIR}/config.yaml`,
      `model: gpt-5.3-codex-spark\nactive_hours:\n  start: "09:00"\n  end: "22:00"\n`
    );
    const config = loadConfig();
    expect(config.model).toBe("gpt-5.3-codex-spark");
    expect(config.activeHours.start).toBe("09:00");
    expect(config.activeHours.end).toBe("22:00");
  });

  test("returns defaults when no config file exists", () => {
    const config = loadConfig();
    expect(config.model).toBe("default");
    expect(config.activeHours.start).toBe("00:00");
    expect(config.activeHours.end).toBe("23:59");
    expect(config.timezone).toBeTruthy();
  });

  test("loads valid timezone", () => {
    writeFileSync(`${TEST_DIR}/config.yaml`, `timezone: America/New_York\n`);
    const config = loadConfig();
    expect(config.timezone).toBe("America/New_York");
  });

  test("falls back to system timezone on invalid timezone", () => {
    writeFileSync(`${TEST_DIR}/config.yaml`, `timezone: Not/A/Timezone\n`);
    const config = loadConfig();
    expect(config.timezone).not.toBe("Not/A/Timezone");
    expect(config.timezone).toBeTruthy();
  });

  test("falls back on invalid YAML", () => {
    writeFileSync(`${TEST_DIR}/config.yaml`, `{{{invalid yaml`);
    const config = loadConfig();
    expect(config.model).toBe("default");
  });

  test("falls back on invalid active_hours format", () => {
    writeFileSync(`${TEST_DIR}/config.yaml`, `active_hours:\n  start: "9am"\n  end: "10pm"\n`);
    const config = loadConfig();
    expect(config.activeHours.start).toBe("00:00");
    expect(config.activeHours.end).toBe("23:59");
  });

  test("parses nested channels.telegram.open", () => {
    writeFileSync(`${TEST_DIR}/config.yaml`, `channels:\n  telegram:\n    open: true\n`);
    const config = loadConfig();
    expect(config.channels.telegram.open).toBe(true);
  });

  test("channels.telegram.open defaults to false", () => {
    writeFileSync(`${TEST_DIR}/config.yaml`, `model: default\n`);
    const config = loadConfig();
    expect(config.channels.telegram.open).toBe(false);
  });

  test("nested channels format loads correctly", () => {
    writeFileSync(`${TEST_DIR}/config.yaml`, [
      "channels:",
      "  enabled: false",
      "  default: slack",
      "  telegram:",
      "    bot_token: test-token",
      "    chat_id: 12345",
      "  slack:",
      "    bot_token: xoxb-test",
      "    app_token: xapp-test",
      "",
    ].join("\n"));
    const config = loadConfig();
    expect(config.channels.enabled).toBe(false);
    expect(config.channels.default).toBe("slack");
    expect(config.channels.telegram.bot_token).toBe("test-token");
    expect(config.channels.telegram.chat_id).toBe(12345);
    expect(config.channels.slack.bot_token).toBe("xoxb-test");
    expect(config.channels.slack.app_token).toBe("xapp-test");
  });

  test("env var overrides database_url", () => {
    writeFileSync(`${TEST_DIR}/config.yaml`, `database_url: postgres://config\n`);
    process.env.DATABASE_URL = "postgres://env";
    const config = loadConfig();
    expect(config.database_url).toBe("postgres://env");
    delete process.env.DATABASE_URL;
  });
});
