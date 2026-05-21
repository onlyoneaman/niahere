/**
 * Where an outbound payload is delivered.
 *
 * - `owner` → the channel's configured default recipient (DM user, owner
 *   phone number, etc.). Always supported.
 * - `thread` → reply in a specific Slack thread. Channels that don't
 *   support threads fall back to `owner`.
 */
export type Recipient = { kind: "owner" } | { kind: "thread"; channelId: string; threadTs?: string };

export interface OutboundMedia {
  data: Uint8Array;
  mimeType: string;
  filename?: string;
}

/**
 * Structured payload for agent-initiated outbound messages (`send_message`
 * MCP tool, cross-channel notifications). Replaces the old optional
 * sendMessage / sendMedia / sendToThread / sendMediaToThread surface.
 */
export interface Outbound {
  text?: string;
  media?: OutboundMedia;
  /** Defaults to `{ kind: "owner" }`. */
  to?: Recipient;
}

export interface Channel {
  /** Channel identifier. Built-in channels use the `ChannelName` literals; test fixtures may use other strings. */
  name: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  /**
   * Deliver an outbound payload. Channels are expected to handle either
   * a text-only, media-only, or text+media payload; format details (chunking,
   * markdown, attachment shape) are channel-specific.
   */
  deliver(out: Outbound): Promise<void>;
}

export type ChannelFactory = () => Channel | null;
