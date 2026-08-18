import { describe, expect, test } from "bun:test";
import { findSecret, SECRET_PATTERNS } from "../../src/utils/secrets";

describe("findSecret", () => {
  /**
   * Built from fragments rather than written out. A realistic-looking literal
   * in source trips secret scanners — GitHub push protection blocked this very
   * file — and a test fixture is never worth teaching anyone to click past that.
   */
  const j = (...parts: string[]) => parts.join("");
  const B36 = "AbCdEf0123456789AbCdEf0123456789AbCd";

  const secrets: [string, string][] = [
    ["anthropic key", j("remember my key sk-", "ant-", "api03-", B36)],
    ["openai key", j("use sk-", "proj-", B36, "0123")],
    ["slack bot token", j("the bot token is xox", "b-", "123456789012-1234567890123-", B36)],
    ["slack app token", j("xap", "p-1-A01234567-1234567890123-", "abcdef0123456789")],
    ["github pat", j("gh token gh", "p_", B36)],
    ["aws access key", j("AK", "IAIOSFODNN7EXAMPLE", " is the key")],
    ["postgres url with password", j("db is postgres://", "admin:", "hunter2", "@db.internal:5432/app")],
    ["bearer header", j("send Authorization: Bearer ", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abc")],
    ["private key block", j("-----BEGIN ", "RSA PRIVATE KEY", "-----\nMIIEowIBAAKCAQEA\n")],
    ["claude oauth token", j("sk-", "ant-", "oat01-", B36)],
  ];

  for (const [label, text] of secrets) {
    test(`catches a ${label}`, () => {
      expect(findSecret(text)).not.toBeNull();
    });
  }

  test("names what it found, so the rejection is actionable", () => {
    expect(findSecret(["sk-", "ant-", "api03-", "AbCdEf0123456789AbCdEf0123456789AbCd"].join(""))).toBe(
      "Anthropic API key",
    );
  });

  const innocent = [
    "Aman prefers merge commits over squash",
    "the deploy script lives in scripts/deploy.sh",
    "use Bearer auth for that API",           // no credential after it
    "postgres://localhost:5432/niahere",      // no password
    "his github handle is ghp-something",     // wrong separator, too short
    "AKIA is an AWS key prefix",              // prefix alone, not a key
    "talk about sk- prefixes generally",
  ];
  for (const text of innocent) {
    test(`leaves alone: ${text.slice(0, 40)}`, () => {
      expect(findSecret(text)).toBeNull();
    });
  }

  test("every pattern is anchored enough not to fire on prose", () => {
    const prose = "We discussed the API key rotation policy and the bearer token design at length.";
    for (const { name, pattern } of SECRET_PATTERNS) {
      expect([name, pattern.test(prose)]).toEqual([name, false]);
    }
  });
});

describe("the write paths that feed every system prompt", () => {
  const KEY = ["sk-", "ant-", "api03-", "AbCdEf0123456789AbCdEf0123456789AbCd"].join("");

  test("addMemory refuses a credential and says where it belongs", async () => {
    const { addMemory } = await import("../../src/utils/memory");
    const out = addMemory(`the api key is ${KEY}`);
    expect(out).toContain("Rejected");
    expect(out).toContain("Anthropic API key");
    expect(out).toContain("config.yaml");
  });

  test("addRule refuses one too — it used to validate nothing at all", async () => {
    const { addRule } = await import("../../src/mcp/tools/misc");
    const out = addRule(`always auth with ${KEY}`);
    expect(out).toContain("Rejected");
    expect(out).toContain("Anthropic API key");
  });

  test("addRule refuses an empty rule instead of appending a bare dash", async () => {
    const { addRule } = await import("../../src/mcp/tools/misc");
    expect(addRule("   ")).toContain("Rejected");
  });

  test("an ordinary rule is untouched", async () => {
    const { addRule } = await import("../../src/mcp/tools/misc");
    expect(addRule("prefer merge commits over squash")).not.toContain("Rejected");
  });
});
