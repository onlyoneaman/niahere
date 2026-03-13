import { describe, expect, test } from "bun:test";
import { guessMime } from "../../src/mcp/tools";

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
