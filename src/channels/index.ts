import type { Channel } from "../types";
import { registerChannel, getFactories, trackStarted, clearStarted } from "./registry";
import { log } from "../utils/log";
import { createTelegramChannel } from "./telegram";
import { createSlackChannel } from "./slack";

export { getChannel } from "./registry";

/** Register all built-in channel factories. Call once at startup. */
export function registerAllChannels(): void {
  registerChannel(() => createTelegramChannel());
  registerChannel(() => createSlackChannel());
}

export async function startChannels(): Promise<Channel[]> {
  const channels: Channel[] = [];

  for (const factory of getFactories()) {
    const channel = factory();
    if (!channel) continue;

    try {
      await channel.start();
      channels.push(channel);
      trackStarted(channel);
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
  clearStarted();
}
