import type { ChannelFactory } from "./channel";

const factories: ChannelFactory[] = [];

export function registerChannel(factory: ChannelFactory): void {
  factories.push(factory);
}

export function getFactories(): readonly ChannelFactory[] {
  return factories;
}
