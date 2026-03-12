export interface Channel {
  name: string;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export type ChannelFactory = () => Channel | null;
