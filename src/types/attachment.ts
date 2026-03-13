export interface Attachment {
  type: "image" | "document";
  data: Buffer;
  mimeType: string;
  filename?: string;
}

const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024; // 10MB

const IMAGE_MIMES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

const DOCUMENT_MIMES = new Set([
  "text/plain",
  "text/markdown",
  "text/csv",
  "text/html",
  "application/json",
  "application/pdf",
]);

export function classifyMime(mimeType: string): "image" | "document" | null {
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

const MAX_DIMENSION = 1568; // Claude vision sweet spot
const JPEG_QUALITY = 80;

/**
 * Resize and compress an image to reduce payload size.
 * - Caps longest side at 1568px (Claude's recommended max)
 * - Converts PNG/WebP to JPEG (unless transparent)
 * - Compresses JPEG at 80% quality
 * Returns { data, mimeType } with potentially updated values.
 */
export async function prepareImage(data: Buffer, mimeType: string): Promise<{ data: Buffer; mimeType: string }> {
  // GIF: pass through to preserve animation
  if (mimeType === "image/gif") return { data, mimeType };

  const sharp = (await import("sharp")).default;

  let pipeline = sharp(data);
  const metadata = await pipeline.metadata();

  const w = metadata.width || 0;
  const h = metadata.height || 0;

  // Resize if larger than max dimension
  if (w > MAX_DIMENSION || h > MAX_DIMENSION) {
    pipeline = pipeline.resize(MAX_DIMENSION, MAX_DIMENSION, { fit: "inside", withoutEnlargement: true });
  }

  // Convert to JPEG for smaller payload
  const result = await pipeline.jpeg({ quality: JPEG_QUALITY }).toBuffer();
  return { data: result, mimeType: "image/jpeg" };
}
