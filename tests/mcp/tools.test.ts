import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync, readFileSync } from "fs";
import { trackStarted, clearStarted } from "../../src/channels/registry";
import {
  guessMime,
  addRule,
  addMemory,
  addWatchChannel,
  removeWatchChannel,
  enableWatchChannel,
  disableWatchChannel,
  sendMessage,
} from "../../src/mcp/tools";
import { resetConfig } from "../../src/utils/config";

const TEST_DIR = "/tmp/test-nia-mcp-tools";

beforeEach(() => {
  mkdirSync(`${TEST_DIR}/self`, { recursive: true });
  process.env.NIA_HOME = TEST_DIR;
});

afterEach(() => {
  clearStarted();
  rmSync(TEST_DIR, { recursive: true, force: true });
  delete process.env.NIA_HOME;
  resetConfig();
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

describe("sendMessage", () => {
  test("sends media to the active Slack thread when thread context is present", async () => {
    mkdirSync(`${TEST_DIR}/tmp`, { recursive: true });
    const mediaPath = `${TEST_DIR}/tmp/report.txt`;
    writeFileSync(mediaPath, "hello");

    const mediaCalls: Array<Record<string, unknown>> = [];
    trackStarted({
      name: "slack",
      start: async () => {},
      stop: async () => {},
      sendMedia: async () => {
        throw new Error("sendMedia should not be called for thread media");
      },
      sendMediaToThread: async (channelId, data, mimeType, filename, threadTs) => {
        mediaCalls.push({
          channelId,
          data: data.toString(),
          mimeType,
          filename,
          threadTs,
        });
      },
    });

    const result = await sendMessage("", "slack", mediaPath, {
      channel: "slack",
      room: "slack-C123-t1710000000.000000-1",
      slackChannelId: "C123",
      slackThreadTs: "1710000000.000000",
    });

    expect(result).toBe("Message with media sent.");
    expect(mediaCalls).toEqual([
      {
        channelId: "C123",
        data: "hello",
        mimeType: "text/plain",
        filename: "report.txt",
        threadTs: "1710000000.000000",
      },
    ]);
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

  test("rejects empty entry", () => {
    writeFileSync(`${TEST_DIR}/self/memory.md`, "# Memory\n");
    expect(addMemory("")).toContain("Rejected");
    expect(addMemory("   ")).toContain("Rejected");
  });

  test("rejects entries over 300 chars", () => {
    writeFileSync(`${TEST_DIR}/self/memory.md`, "# Memory\n");
    const long = "a".repeat(301);
    expect(addMemory(long)).toContain("Rejected");
  });

  test("rejects raw transcripts", () => {
    writeFileSync(`${TEST_DIR}/self/memory.md`, "# Memory\n");
    expect(addMemory("[Thread context] some log dump")).toContain("Rejected");
    expect(addMemory("blah [Current message] blah")).toContain("Rejected");
  });

  test("rejects entries with too many lines", () => {
    writeFileSync(`${TEST_DIR}/self/memory.md`, "# Memory\n");
    const multiline = "line1\nline2\nline3\nline4\nline5\nline6";
    expect(addMemory(multiline)).toContain("Rejected");
  });
});

describe("watch channel tools", () => {
  test("addWatchChannel creates watch entry in config", () => {
    writeFileSync(`${TEST_DIR}/config.yaml`, "channels:\n  slack:\n    bot_token: test\n");
    resetConfig();

    const result = addWatchChannel("C123#test", "Monitor things");
    expect(result).toContain("added");

    const yaml = readFileSync(`${TEST_DIR}/config.yaml`, "utf8");
    expect(yaml).toContain("C123#test");
    expect(yaml).toContain("Monitor things");
  });

  test("removeWatchChannel removes entry", () => {
    writeFileSync(`${TEST_DIR}/config.yaml`, [
      "channels:",
      "  slack:",
      "    watch:",
      "      C123#test:",
      "        behavior: Monitor",
      "        enabled: true",
    ].join("\n"));
    resetConfig();

    const result = removeWatchChannel("C123#test");
    expect(result).toContain("removed");

    const yaml = readFileSync(`${TEST_DIR}/config.yaml`, "utf8");
    expect(yaml).not.toContain("C123#test");
  });

  test("removeWatchChannel returns not found for missing channel", () => {
    writeFileSync(`${TEST_DIR}/config.yaml`, "channels:\n  slack:\n    bot_token: test\n");
    resetConfig();

    expect(removeWatchChannel("nonexistent")).toContain("not found");
  });

  test("enableWatchChannel sets enabled to true", () => {
    writeFileSync(`${TEST_DIR}/config.yaml`, [
      "channels:",
      "  slack:",
      "    watch:",
      "      C123#test:",
      "        behavior: Monitor",
      "        enabled: false",
    ].join("\n"));
    resetConfig();

    const result = enableWatchChannel("C123#test");
    expect(result).toContain("enabled");

    const yaml = readFileSync(`${TEST_DIR}/config.yaml`, "utf8");
    expect(yaml).toContain("enabled: true");
  });

  test("disableWatchChannel sets enabled to false", () => {
    writeFileSync(`${TEST_DIR}/config.yaml`, [
      "channels:",
      "  slack:",
      "    watch:",
      "      C123#test:",
      "        behavior: Monitor",
      "        enabled: true",
    ].join("\n"));
    resetConfig();

    const result = disableWatchChannel("C123#test");
    expect(result).toContain("disabled");

    const yaml = readFileSync(`${TEST_DIR}/config.yaml`, "utf8");
    expect(yaml).toContain("enabled: false");
  });
});
