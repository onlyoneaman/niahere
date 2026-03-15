import type { AttachmentType } from "../types";
import { IMAGE_MIMES, DOCUMENT_MIMES, MAX_ATTACHMENT_SIZE, MAX_IMAGE_DIMENSION, JPEG_QUALITY } from "../constants/attachment";

export function classifyMime(mimeType: string): AttachmentType | null {
  if (IMAGE_MIMES.has(mimeType)) return "image";
  if (DOCUMENT_MIMES.has(mimeType)) return "document";
  if (mimeType.startsWith("text/")) return "document";
  return null;
}

export function validateAttachment(data: Buffer, mimeType: string): string | null {
  if (data.length > MAX_ATTACHMENT_SIZE) {
    return `File too large (${(data.length / 1024 / 1024).toFixed(1)}MB, max ${MAX_ATTACHMENT_SIZE / 1024 / 1024}MB)`;
  }
  if (!classifyMime(mimeType)) {
    return `Unsupported file type: ${mimeType}`;
  }
  return null;
}

/**
 * Resize and compress an image to reduce payload size.
 * - Caps longest side at 1568px (Claude's recommended max)
 * - Converts PNG/WebP to JPEG
 * - Compresses JPEG at 80% quality
 */
export async function prepareImage(data: Buffer, mimeType: string): Promise<{ data: Buffer; mimeType: string }> {
  if (mimeType === "image/gif") return { data, mimeType };

  const sharp = (await import("sharp")).default;

  let pipeline = sharp(data);
  const metadata = await pipeline.metadata();

  const w = metadata.width || 0;
  const h = metadata.height || 0;

  if (w > MAX_IMAGE_DIMENSION || h > MAX_IMAGE_DIMENSION) {
    pipeline = pipeline.resize(MAX_IMAGE_DIMENSION, MAX_IMAGE_DIMENSION, { fit: "inside", withoutEnlargement: true });
  }

  const result = await pipeline.jpeg({ quality: JPEG_QUALITY }).toBuffer();
  return { data: result, mimeType: "image/jpeg" };
}
