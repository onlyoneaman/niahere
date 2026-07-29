/**
 * Dates a user turn when time has visibly passed.
 *
 * A resumed session replays its transcript with no timestamps, so a reply from
 * three days ago reads as present-tense — ask "what should I wear?" twice in a
 * week and the model happily repeats Monday's weather. The marker is prefixed
 * onto the turn that is sent AND stored, so the transcript dates itself from
 * then on.
 */

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** Gap that counts as "time has passed" even within one day. */
export const GAP_THRESHOLD_MS = 2 * HOUR_MS;

const LOCALE = "en-US";

function localDay(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: timezone,
  }).format(date);
}

function plural(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? "" : "s"}`;
}

/** Floored, never rounded up: the absolute stamp alongside it carries the
 *  precision, so this should not claim more time passed than actually did. */
function elapsed(ms: number): string {
  if (ms >= DAY_MS) return plural(Math.floor(ms / DAY_MS), "day");
  if (ms >= HOUR_MS) return plural(Math.floor(ms / HOUR_MS), "hour");
  return plural(Math.max(1, Math.floor(ms / MINUTE_MS)), "minute");
}

/**
 * The prefix for this turn, or null when the conversation is still continuous.
 * Fires when the local date has changed or the gap exceeds the threshold.
 */
export function gapMarker(now: Date, last: Date | null, timezone: string): string | null {
  if (!last) return null;

  const gap = now.getTime() - last.getTime();
  const dayChanged = localDay(now, timezone) !== localDay(last, timezone);
  if (gap < GAP_THRESHOLD_MS && !dayChanged) return null;

  const stamp = new Intl.DateTimeFormat(LOCALE, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
  }).format(now);

  return `[${stamp} — ${elapsed(gap)} since the last message]`;
}
