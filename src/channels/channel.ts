export interface Channel {
  name: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  sendMessage?(text: string): Promise<void>;
}

export type ChannelFactory = () => Channel | null;
