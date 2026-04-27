import { describe, expect, test } from "bun:test";
import { buildContentBlocks } from "../../src/chat/engine";
import type { Attachment } from "../../src/types/attachment";

describe("buildContentBlocks", () => {
  test("returns plain string when no attachments", () => {
    const result = buildContentBlocks("hello world");
    expect(result).toBe("hello world");
  });

  test("returns plain string when attachments is empty array", () => {
    const result = buildContentBlocks("hello world", []);
    expect(result).toBe("hello world");
  });

  test("returns plain string when attachments is undefined", () => {
    const result = buildContentBlocks("hello world", undefined);
    expect(result).toBe("hello world");
  });

  test("builds image content block with base64", () => {
    const imageData = Buffer.from("fake-image-data");
    const attachment: Attachment = {
      type: "image",
      data: imageData,
      mimeType: "image/jpeg",
    };

    const result = buildContentBlocks("describe this", [attachment]);
    expect(Array.isArray(result)).toBe(true);

    const blocks = result as any[];
    expect(blocks).toHaveLength(2);

    // Image block first
    expect(blocks[0].type).toBe("image");
    expect(blocks[0].source.type).toBe("base64");
    expect(blocks[0].source.media_type).toBe("image/jpeg");
    expect(blocks[0].source.data).toBe(imageData.toString("base64"));

    // Text block second
    expect(blocks[1].type).toBe("text");
    expect(blocks[1].text).toBe("describe this");
  });

  test("builds document content block with text content", () => {
    const docContent = "line 1\nline 2\nline 3";
    const attachment: Attachment = {
      type: "document",
      data: Buffer.from(docContent),
      mimeType: "text/plain",
      filename: "notes.txt",
    };

    const result = buildContentBlocks("summarize this", [attachment]);
    expect(Array.isArray(result)).toBe(true);

    const blocks = result as any[];
    expect(blocks).toHaveLength(2);

    // Document block with filename label
    expect(blocks[0].type).toBe("text");
    expect(blocks[0].text).toContain("[notes.txt]");
    expect(blocks[0].text).toContain(docContent);

    // User text
    expect(blocks[1].type).toBe("text");
    expect(blocks[1].text).toBe("summarize this");
  });

  test("uses [document] label when no filename", () => {
    const attachment: Attachment = {
      type: "document",
      data: Buffer.from("content"),
      mimeType: "text/plain",
    };

    const result = buildContentBlocks("read this", [attachment]);
    const blocks = result as any[];
    expect(blocks[0].text).toContain("[document]");
  });

  test("handles multiple attachments", () => {
    const attachments: Attachment[] = [
      { type: "image", data: Buffer.from("img1"), mimeType: "image/png" },
      { type: "image", data: Buffer.from("img2"), mimeType: "image/jpeg" },
      { type: "document", data: Buffer.from("doc"), mimeType: "text/plain", filename: "readme.md" },
    ];

    const result = buildContentBlocks("compare these", attachments);
    const blocks = result as any[];

    expect(blocks).toHaveLength(4); // 2 images + 1 doc + 1 text
    expect(blocks[0].type).toBe("image");
    expect(blocks[1].type).toBe("image");
    expect(blocks[2].type).toBe("text"); // document
    expect(blocks[2].text).toContain("[readme.md]");
    expect(blocks[3].type).toBe("text"); // user message
    expect(blocks[3].text).toBe("compare these");
  });

  test("omits text block when message is empty", () => {
    const attachment: Attachment = {
      type: "image",
      data: Buffer.from("img"),
      mimeType: "image/jpeg",
    };

    const result = buildContentBlocks("", [attachment]);
    const blocks = result as any[];

    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("image");
  });

  test("preserves image MIME types correctly", () => {
    const mimes = ["image/jpeg", "image/png", "image/gif", "image/webp"];

    for (const mime of mimes) {
      const attachment: Attachment = {
        type: "image",
        data: Buffer.from("data"),
        mimeType: mime,
      };
      const result = buildContentBlocks("test", [attachment]);
      const blocks = result as any[];
      expect(blocks[0].source.media_type).toBe(mime);
    }
  });

  test("uses only local path hints when attachment source paths are present", () => {
    const attachment: Attachment = {
      type: "image",
      data: Buffer.from("img"),
      mimeType: "image/png",
      filename: "photo.png",
      sourcePath: "/tmp/nia-attachment-photo.png",
    };

    const result = buildContentBlocks("forward this", [attachment]);
    const blocks = result as any[];

    expect(blocks).toHaveLength(2);
    expect(blocks[0].type).toBe("text");
    expect(blocks[0].text).toContain("[Attachment local paths]");
    expect(blocks[0].text).toContain("photo.png (image, image/png)");
    expect(blocks[0].text).toContain("/tmp/nia-attachment-photo.png");
    expect(blocks[1].type).toBe("text");
    expect(blocks[1].text).toBe("forward this");
  });

  test("does not decode source path documents into message content", () => {
    const attachment: Attachment = {
      type: "document",
      data: Buffer.from("secret document content"),
      mimeType: "application/pdf",
      filename: "report.pdf",
      sourcePath: "/tmp/report.pdf",
    };

    const result = buildContentBlocks("inspect this", [attachment]);
    const blocks = result as any[];

    expect(blocks).toHaveLength(2);
    expect(blocks[0].text).toContain("report.pdf (document, application/pdf)");
    expect(blocks[0].text).toContain("/tmp/report.pdf");
    expect(blocks[0].text).not.toContain("secret document content");
    expect(blocks[1].text).toBe("inspect this");
  });

  test("adds local path hints for generic files", () => {
    const attachment: Attachment = {
      type: "file",
      data: Buffer.from("binary"),
      mimeType: "application/zip",
      filename: "archive.zip",
      sourcePath: "/tmp/archive.zip",
    };

    const result = buildContentBlocks("forward this file", [attachment]);
    const blocks = result as any[];

    expect(blocks).toHaveLength(2);
    expect(blocks[0].text).toContain("archive.zip (file, application/zip)");
    expect(blocks[0].text).toContain("/tmp/archive.zip");
    expect(blocks[0].text).not.toContain("binary");
    expect(blocks[1].text).toBe("forward this file");
  });

  test("does not add local path hints when source paths are absent", () => {
    const attachment: Attachment = {
      type: "image",
      data: Buffer.from("img"),
      mimeType: "image/png",
      filename: "photo.png",
    };

    const result = buildContentBlocks("describe", [attachment]);
    const blocks = result as any[];

    expect(blocks).toHaveLength(2);
    expect(blocks[0].type).toBe("image");
    expect(blocks[1].type).toBe("text");
  });
});
