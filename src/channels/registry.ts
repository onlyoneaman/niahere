import type { Channel, ChannelFactory } from "./channel";

const factories: ChannelFactory[] = [];
const started: Map<string, Channel> = new Map();

export function registerChannel(factory: ChannelFactory): void {
  factories.push(factory);
}

export function getFactories(): readonly ChannelFactory[] {
  return factories;
}

export function trackStarted(channel: Channel): void {
  started.set(channel.name, channel);
}

export function getChannel(name: string): Channel | undefined {
  return started.get(name);
}

export function clearStarted(): void {
  started.clear();
}
