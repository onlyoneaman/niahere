export interface Channel {
  name: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  sendMessage?(text: string): Promise<void>;
  sendMedia?(data: Buffer, mimeType: string, filename?: string): Promise<void>;
}

export type ChannelFactory = () => Channel | null;
