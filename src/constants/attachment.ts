export const MAX_ATTACHMENT_SIZE = 25 * 1024 * 1024; // 25MB

export const IMAGE_MIMES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

export const DOCUMENT_MIMES = new Set([
  "text/plain",
  "text/markdown",
  "text/csv",
  "text/html",
  "application/json",
  "application/pdf",
]);

export const MAX_IMAGE_DIMENSION = 1568; // Claude vision sweet spot
export const JPEG_QUALITY = 80;
