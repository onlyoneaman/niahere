import { readRawConfig, updateRawConfig, writeRawConfig } from "../../utils/config";

export function addWatchChannel(name: string, behavior?: string): string {
  const raw = readRawConfig();
  const channels = (raw.channels || {}) as Record<string, unknown>;
  const slack = (channels.slack || {}) as Record<string, unknown>;
  const entry: Record<string, unknown> = { enabled: true };
  if (behavior !== undefined && behavior !== "") entry.behavior = behavior;
  const watch = {
    ...((slack.watch || {}) as Record<string, unknown>),
    [name]: entry,
  };
  updateRawConfig({ channels: { slack: { watch } } });
  return `Watch channel "${name}" added (enabled). Takes effect on next message.`;
}

export function removeWatchChannel(name: string): string {
  const raw = readRawConfig();
  const channels = (raw.channels || {}) as Record<string, unknown>;
  const slack = (channels.slack || {}) as Record<string, unknown>;
  const watch = (slack.watch || {}) as Record<string, unknown>;
  if (!watch[name]) return `Watch channel "${name}" not found.`;
  delete watch[name];
  writeRawConfig(raw);
  return `Watch channel "${name}" removed. Takes effect on next message.`;
}

export function enableWatchChannel(name: string): string {
  const raw = readRawConfig();
  const channels = (raw.channels || {}) as Record<string, unknown>;
  const slack = (channels.slack || {}) as Record<string, unknown>;
  const watch = (slack.watch || {}) as Record<string, unknown>;
  if (!watch[name]) return `Watch channel "${name}" not found.`;
  const entry = watch[name] as Record<string, unknown>;
  entry.enabled = true;
  updateRawConfig({ channels: { slack: { watch } } });
  return `Watch channel "${name}" enabled. Takes effect on next message.`;
}

export function disableWatchChannel(name: string): string {
  const raw = readRawConfig();
  const channels = (raw.channels || {}) as Record<string, unknown>;
  const slack = (channels.slack || {}) as Record<string, unknown>;
  const watch = (slack.watch || {}) as Record<string, unknown>;
  if (!watch[name]) return `Watch channel "${name}" not found.`;
  const entry = watch[name] as Record<string, unknown>;
  entry.enabled = false;
  updateRawConfig({ channels: { slack: { watch } } });
  return `Watch channel "${name}" disabled. Takes effect on next message.`;
}
