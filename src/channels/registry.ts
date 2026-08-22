import type { Channel, ChannelFactory } from "../types";

const factories: ChannelFactory[] = [];
const started: Map<string, Channel> = new Map();

export function registerChannel(factory: ChannelFactory): void {
  factories.push(factory);
}

export function getFactories(): readonly ChannelFactory[] {
  return factories;
}

export function clearFactories(): void {
  factories.length = 0;
}

export function trackStarted(channel: Channel): void {
  started.set(channel.name, channel);
}

export function getChannel(name: string): Channel | undefined {
  return started.get(name);
}

export function getStarted(): Channel[] {
  return [...started.values()];
}

export function untrackStarted(name: string): void {
  started.delete(name);
}

export function clearStarted(): void {
  started.clear();
}
