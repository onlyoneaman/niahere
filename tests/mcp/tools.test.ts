import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync, readFileSync } from "fs";
import { guessMime, addRule, addMemory } from "../../src/mcp/tools";

const TEST_DIR = "/tmp/test-nia-mcp-tools";

beforeEach(() => {
  mkdirSync(`${TEST_DIR}/self`, { recursive: true });
  process.env.NIA_HOME = TEST_DIR;
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
  delete process.env.NIA_HOME;
});

describe("guessMime", () => {
  test("detects image MIME types", () => {
    expect(guessMime("/path/to/photo.jpg")).toBe("image/jpeg");
    expect(guessMime("/path/to/photo.jpeg")).toBe("image/jpeg");
    expect(guessMime("/path/to/image.png")).toBe("image/png");
    expect(guessMime("/path/to/anim.gif")).toBe("image/gif");
    expect(guessMime("/path/to/modern.webp")).toBe("image/webp");
  });

  test("detects document MIME types", () => {
    expect(guessMime("/path/to/readme.txt")).toBe("text/plain");
    expect(guessMime("/path/to/notes.md")).toBe("text/markdown");
    expect(guessMime("/path/to/data.csv")).toBe("text/csv");
    expect(guessMime("/path/to/config.json")).toBe("application/json");
    expect(guessMime("/path/to/report.pdf")).toBe("application/pdf");
    expect(guessMime("/path/to/page.html")).toBe("text/html");
  });

  test("returns octet-stream for unknown extensions", () => {
    expect(guessMime("/path/to/file.xyz")).toBe("application/octet-stream");
    expect(guessMime("/path/to/binary.bin")).toBe("application/octet-stream");
    expect(guessMime("/path/to/archive.zip")).toBe("application/octet-stream");
  });

  test("handles files with no extension", () => {
    expect(guessMime("/path/to/Makefile")).toBe("application/octet-stream");
  });

  test("is case-insensitive for extensions", () => {
    expect(guessMime("/path/to/photo.JPG")).toBe("image/jpeg");
    expect(guessMime("/path/to/image.PNG")).toBe("image/png");
  });

  test("handles paths with dots in directory names", () => {
    expect(guessMime("/path/v2.0/photo.png")).toBe("image/png");
  });
});

describe("addRule", () => {
  test("appends rule to rules.md", () => {
    writeFileSync(`${TEST_DIR}/self/rules.md`, "# Rules\n");

    addRule("stamp: 2 lines max");

    const content = readFileSync(`${TEST_DIR}/self/rules.md`, "utf8");
    expect(content).toContain("- stamp: 2 lines max");
  });

  test("appends multiple rules", () => {
    writeFileSync(`${TEST_DIR}/self/rules.md`, "# Rules\n");

    addRule("first rule");
    addRule("second rule");

    const content = readFileSync(`${TEST_DIR}/self/rules.md`, "utf8");
    expect(content).toContain("- first rule");
    expect(content).toContain("- second rule");
  });

  test("returns confirmation message", () => {
    writeFileSync(`${TEST_DIR}/self/rules.md`, "# Rules\n");

    const result = addRule("test rule");
    expect(result).toContain("Rule added");
  });
});

describe("addMemory", () => {
  test("creates date header and appends entry", () => {
    writeFileSync(`${TEST_DIR}/self/memory.md`, "# Memory\n\n---\n");

    addMemory("DB was flaky");

    const content = readFileSync(`${TEST_DIR}/self/memory.md`, "utf8");
    const date = new Date().toISOString().slice(0, 10);
    expect(content).toContain(`## ${date}`);
    expect(content).toContain("- DB was flaky");
  });

  test("groups multiple entries under same date header", () => {
    writeFileSync(`${TEST_DIR}/self/memory.md`, "# Memory\n\n---\n");

    addMemory("first thing");
    addMemory("second thing");

    const content = readFileSync(`${TEST_DIR}/self/memory.md`, "utf8");
    const date = new Date().toISOString().slice(0, 10);

    // Only one date header
    const headerCount = content.split(`## ${date}`).length - 1;
    expect(headerCount).toBe(1);

    // Both entries present
    expect(content).toContain("- first thing");
    expect(content).toContain("- second thing");
  });

  test("preserves existing content from other dates", () => {
    writeFileSync(
      `${TEST_DIR}/self/memory.md`,
      "# Memory\n\n---\n\n## 2026-01-01\n- old entry\n",
    );

    addMemory("new entry");

    const content = readFileSync(`${TEST_DIR}/self/memory.md`, "utf8");
    expect(content).toContain("- old entry");
    expect(content).toContain("- new entry");
    expect(content).toContain("## 2026-01-01");
  });

  test("returns confirmation message", () => {
    writeFileSync(`${TEST_DIR}/self/memory.md`, "# Memory\n");

    const result = addMemory("test");
    expect(result).toContain("Memory saved");
  });
});
