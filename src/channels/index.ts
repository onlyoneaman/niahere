import type { Channel } from "../types";
import { registerChannel, getFactories, trackStarted, clearStarted, getStarted, untrackStarted } from "./registry";
import { log } from "../utils/log";
import { ignore } from "../utils/errors";
import { getConfig } from "../utils/config";
import { createTelegramChannel } from "./telegram";
import { createSlackChannel } from "./slack";
import { createPhoneChannel } from "./phone";
import { createSmsChannel } from "./sms";
import { createWhatsAppChannel } from "./whatsapp";
import { getTwilioServer } from "./twilio/server";

export { getChannel, getStarted } from "./registry";

/** Register all built-in channel factories. Call once at startup. */
export function registerAllChannels(): void {
  registerChannel(() => createTelegramChannel());
  registerChannel(() => createSlackChannel());
  registerChannel(() => createPhoneChannel());
  registerChannel(() => createSmsChannel());
  registerChannel(() => createWhatsAppChannel());
}

let reconciling = false;

export interface StartResult {
  started: Channel[];
  failed: string[];
}

export async function startChannels(only?: readonly string[]): Promise<StartResult> {
  const onlySet = only ? new Set(only) : null;
  const pending = getFactories()
    .map((factory) => factory())
    .filter((ch): ch is Channel => ch !== null)
    .filter((ch) => onlySet === null || onlySet.has(ch.name));

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

/**
 * Bring the running channel set back in line with configuration. Starts any
 * configured-but-not-running channels and stops any running-but-unconfigured
 * ones. A no-op when already in sync, so it is safe to call on a timer.
 *
 * This is the recovery path for the boot-time race where channels fail to
 * start because Postgres isn't ready yet (channel `.start()` reads the DB):
 * `startChannels` abandons the failed channels with no retry, so without
 * reconciliation Nia stays alive but deaf on every channel until a manual
 * restart. The alive monitor calls this every healthy heartbeat.
 *
 * It also covers the reverse case, where a channel is tracked as running but
 * its transport has died underneath it. Being in the registry was the only
 * liveness anyone checked, so such a channel was never retried; `healthy()`
 * lets a channel say otherwise and get rebuilt.
 */
export async function reconcileChannels(): Promise<StartResult> {
  // Bringing a channel up can block for as long as its transport takes to
  // connect. Without this, a slow start would let the next heartbeat reconcile
  // the same channel again and leave two of them running.
  if (reconciling) return { started: [], failed: [] };
  reconciling = true;
  try {
    return await reconcile();
  } finally {
    reconciling = false;
  }
}

async function reconcile(): Promise<StartResult> {
  const wanted = getConfiguredChannelNames();
  const running = getStarted();
  const runningNames = new Set(running.map((ch) => ch.name));
  const wantedSet = new Set(wanted);

  const missing = wanted.filter((name) => !runningNames.has(name));
  const extra = running.filter((ch) => !wantedSet.has(ch.name));
  const dead = running.filter((ch) => wantedSet.has(ch.name) && ch.healthy?.() === false);
  if (missing.length === 0 && extra.length === 0 && dead.length === 0) return { started: [], failed: [] };

  const deadNames = dead.map((ch) => ch.name);
  log.warn({ missing, extra: extra.map((ch) => ch.name), dead: deadNames }, "channels out of sync, reconciling");

  // A channel was removed from config. stopChannels() tears down the whole
  // registry (it stops the shared Twilio server and clears all tracking), so a
  // partial stop isn't possible — rebuild the full configured set instead.
  if (extra.length > 0) {
    await stopChannels(running);
    return wanted.length > 0 ? startChannels() : { started: [], failed: [] };
  }

  // Tear the dead ones down individually so healthy channels stay connected. A
  // stop that fails must not block the restart — the point is to replace them.
  for (const channel of dead) {
    await ignore(channel.stop(), `stopping dead channel ${channel.name}`);
    untrackStarted(channel.name);
  }

  // Start just the channels that need it so healthy ones stay connected and one
  // persistently-failing channel can't thrash the rest.
  return startChannels([...missing, ...deadNames]);
}

export function getConfiguredChannelNames(): string[] {
  const { channels } = getConfig();
  if (!channels.enabled) return [];

  const names: string[] = [];
  if (channels.telegram.enabled && channels.telegram.bot_token) names.push("telegram");
  if (channels.slack.enabled && channels.slack.bot_token && channels.slack.app_token) names.push("slack");
  if (channels.phone.enabled && channels.twilio.sid && channels.twilio.secret && channels.phone.from_number) {
    names.push("phone");
  }
  const smsFromNumber = channels.sms.from_number ?? channels.phone.from_number;
  if (channels.sms.enabled && channels.twilio.sid && channels.twilio.secret && smsFromNumber) names.push("sms");
  if (channels.whatsapp.enabled && channels.twilio.sid && channels.twilio.secret && channels.whatsapp.from_number) {
    names.push("whatsapp");
  }
  return names;
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
  // Shared Twilio webhook server outlives any single channel; stop it once
  // all channels are torn down.
  try {
    getTwilioServer().stop();
  } catch (err) {
    log.warn({ err }, "twilio-server stop failed");
  }
  clearStarted();
}
