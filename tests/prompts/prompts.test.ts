import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync } from "fs";
import { resetConfig } from "../../src/utils/config";
import { getEnvironmentPrompt, getModePrompt, getChannelPrompt } from "../../src/prompts";

const TEST_DIR = "/tmp/test-nia-prompts";

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

describe("getModePrompt", () => {
  test("returns chat mode prompt", () => {
    const prompt = getModePrompt("chat");
    expect(prompt).toContain("Chat");
    expect(prompt).toContain("conversational");
  });

  test("returns job mode prompt", () => {
    const prompt = getModePrompt("job");
    expect(prompt).toContain("Job");
    expect(prompt).toContain("terse");
  });
});

describe("getChannelPrompt", () => {
  test("returns slack channel prompt with common rules", () => {
    const prompt = getChannelPrompt("slack");
    expect(prompt).toContain("Channel: Common");
    expect(prompt).toContain("Slack");
    expect(prompt).toContain("Slack bold");
  });

  test("returns telegram channel prompt with common rules", () => {
    const prompt = getChannelPrompt("telegram");
    expect(prompt).toContain("Channel: Common");
    expect(prompt).toContain("Telegram");
    expect(prompt).toContain("MarkdownV2");
  });

  test("returns common prompt for unknown non-terminal channel", () => {
    const prompt = getChannelPrompt("discord");
    expect(prompt).toContain("Channel: Common");
  });

  test("returns empty for terminal channel", () => {
    expect(getChannelPrompt("terminal")).toBe("");
  });
});

describe("getEnvironmentPrompt", () => {
  test("returns interpolated environment prompt", () => {
    const prompt = getEnvironmentPrompt();
    expect(prompt).toContain("Environment");
    expect(prompt).toContain("Managing Jobs");
    expect(prompt).toContain("config.yaml");
  });

  test("contains current timezone", () => {
    const prompt = getEnvironmentPrompt();
    expect(prompt).toContain("Timezone:");
  });
});
