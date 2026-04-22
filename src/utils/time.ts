const PROMPT_DATE_LOCALE = "en-US";

export function localTime(date: Date = new Date(), timezone?: string): string {
  return date.toLocaleString(undefined, timezone ? { timeZone: timezone } : undefined);
}

export function formatPromptDate(date: Date = new Date(), timezone?: string): string {
  const formatted = new Intl.DateTimeFormat(PROMPT_DATE_LOCALE, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    ...(timezone ? { timeZone: timezone } : {}),
  }).format(date);

  return timezone ? `${formatted} (${timezone})` : formatted;
}

export function formatPromptDateTime(date: Date = new Date(), timezone?: string): string {
  const formatted = new Intl.DateTimeFormat(PROMPT_DATE_LOCALE, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
    ...(timezone ? { timeZone: timezone } : {}),
  }).format(date);

  return timezone ? `${formatted} (${timezone})` : formatted;
}
