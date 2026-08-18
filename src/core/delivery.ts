import type { Check } from "../types/health";

/**
 * Whether a reply has a delivery to confirm.
 *
 * Every agent reply was written as `pending` and only channel code ever cleared
 * it — so `nia run`, the REPL and jobs, which print to stdout and are done,
 * left rows pending forever. 23 of the 30 stuck rows on the mini were that,
 * oldest from March, which made the genuinely undelivered ones invisible among
 * them.
 */
const DELIVERING_CHANNELS = new Set(["slack", "telegram", "sms", "whatsapp", "phone"]);

/** Channels whose replies go nowhere but the screen. Unknown names are assumed
 *  to deliver: a false alarm is cheaper than a message quietly lost. */
const LOCAL_CHANNELS = new Set(["terminal", "system", "test"]);

export function awaitsDelivery(channel: string): boolean {
  if (DELIVERING_CHANNELS.has(channel)) return true;
  return !LOCAL_CHANNELS.has(channel);
}

export function initialDeliveryStatus(channel: string): "pending" | "sent" {
  return awaitsDelivery(channel) ? "pending" : "sent";
}

/** Longer than any real send. Slack/Twilio calls finish in seconds. */
export const STUCK_AFTER_MS = 10 * 60 * 1000;

export interface PendingRow {
  room: string;
  createdAt: string;
}

/**
 * Report replies that were written but never confirmed.
 *
 * Deliberately reports rather than resends. The row says a send was *started*;
 * it cannot say whether the channel API completed before the process died. A
 * retry would double-send to a real person on every crash that happened after
 * delivery — so this surfaces the problem and leaves the judgement to someone
 * who can check.
 */
export function auditDelivery(rows: PendingRow[], now: number = Date.now()): Check {
  const stuck = rows.filter((r) => {
    const t = Date.parse(r.createdAt);
    return Number.isFinite(t) && now - t > STUCK_AFTER_MS;
  });
  if (stuck.length === 0) {
    return { name: "delivery", status: "ok", detail: "no messages awaiting confirmation" };
  }
  const oldest = stuck.reduce((a, b) => (Date.parse(a.createdAt) <= Date.parse(b.createdAt) ? a : b));
  const days = Math.floor((now - Date.parse(oldest.createdAt)) / 86_400_000);
  const age = days >= 1 ? `${days}d` : `${Math.round((now - Date.parse(oldest.createdAt)) / 3_600_000)}h`;
  return {
    name: "delivery",
    status: "warn",
    detail: `${stuck.length} repl${stuck.length === 1 ? "y" : "ies"} never confirmed sent, oldest ${age} in ${oldest.room}`,
  };
}
