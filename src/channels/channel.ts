export interface Channel {
  name: string;
  start(workspace: string): Promise<void>;
  stop(): Promise<void>;
}

export type ChannelFactory = () => Channel | null;
