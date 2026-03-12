import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { loadIdentity, buildSystemPrompt } from "../../src/chat/identity";

const TEST_DIR = "/tmp/test-nia-identity";

beforeEach(() => {
  mkdirSync(`${TEST_DIR}/self`, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("loadIdentity", () => {
  test("loads both identity.md and soul.md", () => {
    writeFileSync(`${TEST_DIR}/self/identity.md`, "I am nia");
    writeFileSync(`${TEST_DIR}/self/soul.md`, "Be helpful");

    const result = loadIdentity(TEST_DIR);
    expect(result).toContain("I am nia");
    expect(result).toContain("Be helpful");
  });

  test("loads only identity.md when soul.md is missing", () => {
    writeFileSync(`${TEST_DIR}/self/identity.md`, "I am nia");

    const result = loadIdentity(TEST_DIR);
    expect(result).toBe("I am nia");
  });

  test("loads only soul.md when identity.md is missing", () => {
    writeFileSync(`${TEST_DIR}/self/soul.md`, "Be helpful");

    const result = loadIdentity(TEST_DIR);
    expect(result).toBe("Be helpful");
  });

  test("returns empty string when neither file exists", () => {
    const result = loadIdentity(TEST_DIR);
    expect(result).toBe("");
  });

  test("trims whitespace from files", () => {
    writeFileSync(`${TEST_DIR}/self/identity.md`, "  I am nia  \n\n");
    writeFileSync(`${TEST_DIR}/self/soul.md`, "\n  Be helpful  \n");

    const result = loadIdentity(TEST_DIR);
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

    const prompt = buildSystemPrompt(TEST_DIR);
    expect(prompt).toContain("I am nia");
    expect(prompt).toContain("Be helpful");
    expect(prompt).toContain("live chat session");
  });

  test("includes chat instructions even without identity files", () => {
    const prompt = buildSystemPrompt(TEST_DIR);
    expect(prompt).toContain("live chat session");
  });
});
