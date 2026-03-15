import type { AttachmentType } from "./enums";

export interface Attachment {
  type: AttachmentType;
  data: Buffer;
  mimeType: string;
  filename?: string;
}
