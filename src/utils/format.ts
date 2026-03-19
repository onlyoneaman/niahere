import { localTime } from "./time";

export function maskToken(token: string | null): string {
  return token ? `...${token.slice(-6)}` : "";
}

export function safeDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function dateSortValue(value: string | null | undefined): number {
  const date = safeDate(value);
  return date ? date.getTime() : Number.MAX_SAFE_INTEGER;
}

export function relativeTime(date: Date, now = new Date()): string {
  const deltaMs = date.getTime() - now.getTime();
  const totalSeconds = Math.round(Math.abs(deltaMs) / 1000);

  if (totalSeconds < 5) return "just now";

  const units: Array<[string, number]> = [
    ["d", 24 * 60 * 60],
    ["h", 60 * 60],
    ["m", 60],
    ["s", 1],
  ];

  const parts: string[] = [];
  let secondsLeft = totalSeconds;
  for (const [label, factor] of units) {
    const amount = Math.floor(secondsLeft / factor);
    if (amount > 0 && parts.length < 2) parts.push(`${amount}${label}`);
    secondsLeft %= factor;
  }

  const text = parts.length > 0 ? parts.join(" ") : "1s";
  return deltaMs > 0 ? `in ${text}` : `${text} ago`;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

export function formatTimeLine(date: string | null | undefined, now = new Date()): string {
  const parsed = safeDate(date);
  if (!parsed) return "unknown";
  return `${relativeTime(parsed, now)} (${localTime(parsed)})`;
}
