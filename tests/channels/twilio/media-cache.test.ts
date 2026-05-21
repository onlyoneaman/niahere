import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { cacheMedia, readCachedMedia, getMediaDir } from "../../../src/channels/twilio/media-cache";

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "nia-mc-"));
  process.env.NIA_HOME = tmp;
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
  delete process.env.NIA_HOME;
});

describe("twilio/media-cache", () => {
  test("round-trips a buffer under the configured NIA_HOME", async () => {
    const payload = new Uint8Array(Buffer.from("hello world"));
    const { filename, path } = await cacheMedia(payload, "image/png");

    expect(filename).toMatch(/^[a-f0-9]{32}\.png$/);
    expect(path.startsWith(getMediaDir())).toBe(true);

    const hit = await readCachedMedia(filename);
    expect(hit).not.toBeNull();
    expect(hit!.mime).toBe("image/png");
    expect(hit!.buffer.toString()).toBe("hello world");
  });

  test("uses extension override when provided", async () => {
    const { filename } = await cacheMedia(new Uint8Array([1, 2, 3]), "application/octet-stream", "bin");
    expect(filename.endsWith(".bin")).toBe(true);
  });

  test("rejects filenames that fail the safety regex", async () => {
    expect(await readCachedMedia("../etc/passwd")).toBeNull();
    expect(await readCachedMedia("not-a-hash.png")).toBeNull();
    expect(await readCachedMedia("")).toBeNull();
  });

  test("returns null for missing files", async () => {
    expect(await readCachedMedia("0000000000000000.png")).toBeNull();
  });
});
