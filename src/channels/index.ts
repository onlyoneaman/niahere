import type { Channel, ChannelFactory } from "./channel";
import { log } from "../utils/log";

const factories: ChannelFactory[] = [];

export function registerChannel(factory: ChannelFactory): void {
  factories.push(factory);
}

export async function startChannels(workspace: string): Promise<Channel[]> {
  const channels: Channel[] = [];

  for (const factory of factories) {
    const channel = factory();
    if (!channel) continue;

    try {
      await channel.start(workspace);
      channels.push(channel);
      log.info({ channel: channel.name }, "channel started");
    } catch (err) {
      log.error({ err, channel: channel.name }, "channel failed to start");
    }
  }

  return channels;
}

export async function stopChannels(channels: Channel[]): Promise<void> {
  for (const channel of channels) {
    try {
      await channel.stop();
      log.info({ channel: channel.name }, "channel stopped");
    } catch (err) {
      log.error({ err, channel: channel.name }, "channel failed to stop");
    }
  }
}

export type { Channel, ChannelFactory } from "./channel";
