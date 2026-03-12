export function localTime(date: Date = new Date(), timezone?: string): string {
  return date.toLocaleString(undefined, timezone ? { timeZone: timezone } : undefined);
}
