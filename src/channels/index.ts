import type { Channel } from "./channel";
import { getFactories, registerChannel } from "./registry";
import { log } from "../utils/log";

export { registerChannel };

export async function startChannels(): Promise<Channel[]> {
  const channels: Channel[] = [];

  for (const factory of getFactories()) {
    const channel = factory();
    if (!channel) continue;

    try {
      await channel.start();
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
export { sendToTelegram } from "./telegram";
