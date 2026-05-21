import { describe, expect, test } from "bun:test";
import { chunkText, toWhatsAppMarkdown } from "../../src/channels/whatsapp";

describe("whatsapp/toWhatsAppMarkdown", () => {
  test("converts ** to * for bold", () => {
    expect(toWhatsAppMarkdown("hello **world**")).toBe("hello *world*");
  });

  test("converts ~~ to ~ for strike", () => {
    expect(toWhatsAppMarkdown("a ~~b~~ c")).toBe("a ~b~ c");
  });

  test("leaves single * alone (ambiguous italic vs bold)", () => {
    expect(toWhatsAppMarkdown("*emph*")).toBe("*emph*");
  });

  test("handles multiline spans", () => {
    expect(toWhatsAppMarkdown("**multi\nline**")).toBe("*multi\nline*");
  });

  test("passes plain text through", () => {
    expect(toWhatsAppMarkdown("nothing fancy")).toBe("nothing fancy");
  });
});

describe("whatsapp/chunkText", () => {
  test("returns single chunk when under limit", () => {
    expect(chunkText("short", 100)).toEqual(["short"]);
  });

  test("splits on paragraph boundary when possible", () => {
    const text = "a".repeat(50) + "\n\n" + "b".repeat(50);
    const chunks = chunkText(text, 80);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toBe("a".repeat(50));
    expect(chunks[1]).toBe("b".repeat(50));
  });

  test("falls back to line boundary", () => {
    const text = "line1\n" + "x".repeat(40) + "\nline3";
    const chunks = chunkText(text, 30);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(30);
  });

  test("falls back to space boundary when no newlines", () => {
    const text = "word ".repeat(20).trim();
    const chunks = chunkText(text, 30);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(30);
    expect(chunks.join(" ")).toBe(text);
  });

  test("hard-cuts when no whitespace available", () => {
    const text = "x".repeat(100);
    const chunks = chunkText(text, 30);
    expect(chunks).toHaveLength(4);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(30);
    expect(chunks.join("")).toBe(text);
  });
});

describe("whatsapp /reset detection", () => {
  // The handler uses /^\s*\/(reset|new)\s*$/i internally; this asserts
  // the cases the synthesized scope is opinionated about.
  const RESET_RE = /^\s*\/(reset|new)\s*$/i;

  test("matches /reset and /new exactly", () => {
    expect(RESET_RE.test("/reset")).toBe(true);
    expect(RESET_RE.test("/new")).toBe(true);
    expect(RESET_RE.test("/RESET")).toBe(true);
    expect(RESET_RE.test("  /reset  ")).toBe(true);
  });

  test("does NOT match natural-language phrases starting with the keyword", () => {
    expect(RESET_RE.test("reset")).toBe(false);
    expect(RESET_RE.test("/new chat")).toBe(false);
    expect(RESET_RE.test("/reset please")).toBe(false);
    expect(RESET_RE.test("can you /reset")).toBe(false);
  });
});
