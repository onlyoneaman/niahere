import { describe, expect, test } from "bun:test";
import sharp from "sharp";
import { classifyMime, validateAttachment, prepareImage } from "../../src/utils/attachment";

describe("classifyMime", () => {
  test("classifies image types", () => {
    expect(classifyMime("image/jpeg")).toBe("image");
    expect(classifyMime("image/png")).toBe("image");
    expect(classifyMime("image/gif")).toBe("image");
    expect(classifyMime("image/webp")).toBe("image");
  });

  test("classifies document types", () => {
    expect(classifyMime("text/plain")).toBe("document");
    expect(classifyMime("text/markdown")).toBe("document");
    expect(classifyMime("text/csv")).toBe("document");
    expect(classifyMime("text/html")).toBe("document");
    expect(classifyMime("application/json")).toBe("document");
    expect(classifyMime("application/pdf")).toBe("document");
  });

  test("classifies unknown text/* as document", () => {
    expect(classifyMime("text/xml")).toBe("document");
    expect(classifyMime("text/javascript")).toBe("document");
  });

  test("returns null for unsupported types", () => {
    expect(classifyMime("video/mp4")).toBeNull();
    expect(classifyMime("audio/mpeg")).toBeNull();
    expect(classifyMime("application/octet-stream")).toBeNull();
    expect(classifyMime("application/zip")).toBeNull();
  });
});

describe("validateAttachment", () => {
  test("accepts valid image", () => {
    const data = Buffer.alloc(1024); // 1KB
    expect(validateAttachment(data, "image/jpeg")).toBeNull();
  });

  test("accepts valid document", () => {
    const data = Buffer.from("hello world");
    expect(validateAttachment(data, "text/plain")).toBeNull();
  });

  test("rejects file over 10MB", () => {
    const data = Buffer.alloc(11 * 1024 * 1024); // 11MB
    const error = validateAttachment(data, "image/jpeg");
    expect(error).toContain("too large");
    expect(error).toContain("11.0MB");
    expect(error).toContain("max 10MB");
  });

  test("accepts file exactly at 10MB", () => {
    const data = Buffer.alloc(10 * 1024 * 1024); // exactly 10MB
    expect(validateAttachment(data, "image/jpeg")).toBeNull();
  });

  test("rejects unsupported MIME type", () => {
    const data = Buffer.alloc(100);
    const error = validateAttachment(data, "video/mp4");
    expect(error).toContain("Unsupported");
    expect(error).toContain("video/mp4");
  });

  test("rejects application/octet-stream", () => {
    const data = Buffer.alloc(100);
    expect(validateAttachment(data, "application/octet-stream")).toContain("Unsupported");
  });
});

describe("prepareImage", () => {
  async function makeTestImage(width: number, height: number, format: "png" | "jpeg" | "webp" = "png"): Promise<Buffer> {
    return sharp({ create: { width, height, channels: 3, background: { r: 255, g: 0, b: 0 } } })
      .toFormat(format)
      .toBuffer();
  }

  test("small image passes through with jpeg conversion", async () => {
    const input = await makeTestImage(200, 200, "png");
    const { data, mimeType } = await prepareImage(input, "image/png");

    expect(mimeType).toBe("image/jpeg");
    expect(data.length).toBeLessThan(input.length); // JPEG smaller than PNG for solid color
  });

  test("large image is resized down", async () => {
    const input = await makeTestImage(3000, 2000);
    const { data, mimeType } = await prepareImage(input, "image/png");

    const meta = await sharp(data).metadata();
    expect(meta.width).toBeLessThanOrEqual(1568);
    expect(meta.height).toBeLessThanOrEqual(1568);
    expect(mimeType).toBe("image/jpeg");
  });

  test("image at max dimension is not enlarged", async () => {
    const input = await makeTestImage(1568, 1000);
    const { data } = await prepareImage(input, "image/png");

    const meta = await sharp(data).metadata();
    expect(meta.width).toBe(1568);
    expect(meta.height).toBe(1000);
  });

  test("already small jpeg is recompressed", async () => {
    const input = await makeTestImage(100, 100, "jpeg");
    const { data, mimeType } = await prepareImage(input, "image/jpeg");

    expect(mimeType).toBe("image/jpeg");
    expect(data.length).toBeGreaterThan(0);
  });

  test("gif is passed through without modification", async () => {
    const fakeGif = Buffer.from("GIF89a fake gif data");
    const { data, mimeType } = await prepareImage(fakeGif, "image/gif");

    expect(mimeType).toBe("image/gif");
    expect(data).toBe(fakeGif); // same reference, not copied
  });

  test("webp is converted to jpeg", async () => {
    const input = await makeTestImage(400, 300, "webp");
    const { mimeType } = await prepareImage(input, "image/webp");

    expect(mimeType).toBe("image/jpeg");
  });
});
