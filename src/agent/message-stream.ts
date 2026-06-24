// @ts-ignore — SDK re-exports this type but tsc can't resolve the path under Bun
import type { MessageParam } from "@anthropic-ai/sdk/resources";
import type { Attachment } from "../types/attachment";

export interface SDKUserMessage {
  type: "user";
  message: MessageParam;
  parent_tool_use_id: null;
  session_id: string;
}

/** Convert provider-agnostic attachments to Anthropic content blocks. */
export function buildContentBlocks(text: string, attachments?: Attachment[]): MessageParam["content"] {
  if (!attachments?.length) return text;

  const blocks: Array<
    | { type: "text"; text: string }
    | {
        type: "image";
        source: { type: "base64"; media_type: string; data: string };
      }
  > = [];

  const pathHints = attachments
    .map((att, idx) => {
      if (!att.sourcePath) return "";
      const label = att.filename || `${att.type}-${idx + 1}`;
      return `- ${idx + 1}. ${label} (${att.type}, ${att.mimeType}) -> ${att.sourcePath}`;
    })
    .filter(Boolean);

  if (pathHints.length > 0) {
    blocks.push({
      type: "text",
      text:
        "[Attachment local paths]\n" +
        "Use these absolute paths to inspect attachments. To resend/forward one, call send_message with media_path set to its path.\n" +
        pathHints.join("\n"),
    });
  }

  for (const att of attachments) {
    if (att.sourcePath) continue;

    if (att.type === "image") {
      blocks.push({
        type: "image",
        source: {
          type: "base64",
          media_type: att.mimeType,
          data: att.data.toString("base64"),
        },
      });
    } else if (att.type === "document") {
      const docText = att.data.toString("utf8");
      const label = att.filename ? `[${att.filename}]` : "[document]";
      blocks.push({ type: "text", text: `${label}\n${docText}` });
    }
  }

  if (text) {
    blocks.push({ type: "text", text });
  }

  return blocks as MessageParam["content"];
}

/**
 * Push-based async iterable for streaming user messages to the SDK.
 * Keeps the query subprocess alive between messages (the warm-session
 * optimization): one query() consumes this stream for the life of a session,
 * and each turn pushes one user message onto it.
 */
export class MessageStream {
  private queue: SDKUserMessage[] = [];
  private waiting: (() => void) | null = null;
  private done = false;

  push(text: string, attachments?: Attachment[]): void {
    this.queue.push({
      type: "user",
      message: { role: "user", content: buildContentBlocks(text, attachments) },
      parent_tool_use_id: null,
      session_id: "",
    });
    this.waiting?.();
  }

  end(): void {
    this.done = true;
    this.waiting?.();
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<SDKUserMessage> {
    while (true) {
      while (this.queue.length > 0) {
        yield this.queue.shift()!;
      }
      if (this.done) return;
      await new Promise<void>((r) => {
        this.waiting = r;
      });
      this.waiting = null;
    }
  }
}
