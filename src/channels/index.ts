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

export interface StartResult {
  started: Channel[];
  failed: string[];
}

export async function startChannels(): Promise<StartResult> {
  const pending = getFactories()
    .map((factory) => factory())
    .filter((ch): ch is Channel => ch !== null);

  if (pending.length === 0) return { started: [], failed: [] };

  const results = await Promise.allSettled(
    pending.map(async (channel) => {
      await channel.start();
      return channel;
    }),
  );

  const started: Channel[] = [];
  const failed: string[] = [];
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === "fulfilled") {
      started.push(result.value);
      trackStarted(result.value);
      log.info({ channel: result.value.name }, "channel started");
    } else {
      failed.push(pending[i].name);
      log.error({ err: result.reason, channel: pending[i].name }, "channel failed to start");
    }
  }

  if (failed.length > 0) {
    log.warn({ failed }, "some channels failed to start");
  }

  return { started, failed };
}

export async function stopChannels(channels: Channel[]): Promise<void> {
  const results = await Promise.allSettled(
    channels.map(async (channel) => {
      await channel.stop();
      return channel;
    }),
  );

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === "fulfilled") {
      log.info({ channel: result.value.name }, "channel stopped");
    } else {
      log.error({ err: result.reason, channel: channels[i].name }, "channel failed to stop");
    }
  }
  clearStarted();
}
