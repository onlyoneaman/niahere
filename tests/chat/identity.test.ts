import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { loadIdentity, buildSystemPrompt } from "../../src/chat/identity";
import { resetConfig } from "../../src/utils/config";

const TEST_DIR = "/tmp/test-nia-identity";

beforeEach(() => {
  mkdirSync(`${TEST_DIR}/self`, { recursive: true });
  process.env.NIA_HOME = TEST_DIR;
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
  delete process.env.NIA_HOME;
  resetConfig();
});

describe("loadIdentity", () => {
  test("loads both identity.md and soul.md", () => {
    writeFileSync(`${TEST_DIR}/self/identity.md`, "I am nia");
    writeFileSync(`${TEST_DIR}/self/soul.md`, "Be helpful");

    const result = loadIdentity();
    expect(result).toContain("I am nia");
    expect(result).toContain("Be helpful");
  });

  test("loads only identity.md when soul.md is missing", () => {
    writeFileSync(`${TEST_DIR}/self/identity.md`, "I am nia");

    const result = loadIdentity();
    expect(result).toBe("I am nia");
  });

  test("loads only soul.md when identity.md is missing", () => {
    writeFileSync(`${TEST_DIR}/self/soul.md`, "Be helpful");

    const result = loadIdentity();
    expect(result).toBe("Be helpful");
  });

  test("returns empty string when no files exist", () => {
    const result = loadIdentity();
    expect(result).toBe("");
  });

  test("loads identity, owner, soul, rules, and memory files in order", () => {
    writeFileSync(`${TEST_DIR}/self/identity.md`, "I am nia");
    writeFileSync(`${TEST_DIR}/self/owner.md`, "Owner: Aman");
    writeFileSync(`${TEST_DIR}/self/soul.md`, "Be helpful");
    writeFileSync(`${TEST_DIR}/self/rules.md`, "Keep stamp short");
    writeFileSync(`${TEST_DIR}/self/memory.md`, "Learned: X");

    const result = loadIdentity();
    expect(result).toContain("I am nia");
    expect(result).toContain("Owner: Aman");
    expect(result).toContain("Be helpful");
    expect(result).toContain("Keep stamp short");
    expect(result).toContain("Learned: X");
    // Verify order: identity → owner → soul → rules → memory
    expect(result.indexOf("I am nia")).toBeLessThan(result.indexOf("Owner: Aman"));
    expect(result.indexOf("Owner: Aman")).toBeLessThan(result.indexOf("Be helpful"));
    expect(result.indexOf("Be helpful")).toBeLessThan(result.indexOf("Keep stamp short"));
    expect(result.indexOf("Keep stamp short")).toBeLessThan(result.indexOf("Learned: X"));
  });

  test("loads rules.md when present", () => {
    writeFileSync(`${TEST_DIR}/self/rules.md`, "stamp: 2 lines max");

    const result = loadIdentity();
    expect(result).toBe("stamp: 2 lines max");
  });

  test("works without rules.md", () => {
    writeFileSync(`${TEST_DIR}/self/identity.md`, "I am nia");

    const result = loadIdentity();
    expect(result).toBe("I am nia");
    expect(result).not.toContain("rules");
  });

  test("trims whitespace from files", () => {
    writeFileSync(`${TEST_DIR}/self/identity.md`, "  I am nia  \n\n");
    writeFileSync(`${TEST_DIR}/self/soul.md`, "\n  Be helpful  \n");

    const result = loadIdentity();
    expect(result).toContain("I am nia");
    expect(result).toContain("Be helpful");
    expect(result).not.toMatch(/^\s/);
    expect(result).not.toMatch(/\s$/);
  });
});

describe("buildSystemPrompt", () => {
  test("includes identity content and chat instructions", () => {
    writeFileSync(`${TEST_DIR}/self/identity.md`, "I am nia");
    writeFileSync(`${TEST_DIR}/self/soul.md`, "Be helpful");

    const prompt = buildSystemPrompt();
    expect(prompt).toContain("I am nia");
    expect(prompt).toContain("Be helpful");
    expect(prompt).toContain("live chat session");
  });

  test("includes chat instructions even without identity files", () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain("live chat session");
  });

  test("job mode includes terse instructions", () => {
    const prompt = buildSystemPrompt("job");
    expect(prompt).toContain("Job");
    expect(prompt).not.toContain("live chat session");
  });

  test("telegram channel includes Telegram-specific instructions", () => {
    const prompt = buildSystemPrompt("chat", "telegram");
    expect(prompt).toContain("Telegram");
    expect(prompt).toContain("MarkdownV2");
  });

  test("includes active hours info", () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain("active hours");
  });

  test("includes MCP job management tools", () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain("list_jobs");
    expect(prompt).toContain("add_job");
    expect(prompt).toContain("send_message");
  });

  test("includes add_rule and add_memory tools", () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain("add_rule");
    expect(prompt).toContain("add_memory");
  });

  test("includes rules.md content in system prompt", () => {
    writeFileSync(`${TEST_DIR}/self/rules.md`, "stamp: keep it short");

    const prompt = buildSystemPrompt();
    expect(prompt).toContain("stamp: keep it short");
  });
});
