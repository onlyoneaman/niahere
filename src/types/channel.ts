export interface Channel {
  name: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  sendMessage?(text: string): Promise<void>;
  sendMedia?(data: Buffer, mimeType: string, filename?: string): Promise<void>;
  /** Send media to a specific channel/thread when the channel supports it. */
  sendMediaToThread?(channelId: string, data: Buffer, mimeType: string, filename?: string, threadTs?: string): Promise<void>;
  /** Send a message to a specific channel/thread (e.g. reply back to a Slack thread). */
  sendToThread?(channelId: string, text: string, threadTs?: string): Promise<void>;
}

export type ChannelFactory = () => Channel | null;
