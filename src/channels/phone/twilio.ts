/**
 * Minimal Twilio REST + webhook-signature helpers.
 * Skips the official SDK so the daemon's dependency surface stays small —
 * the surface we use (place call, hang up, swap URL, validate signature) is
 * a handful of well-documented endpoints.
 */
import { createHmac, timingSafeEqual } from "crypto";

const TWILIO_BASE = "https://api.twilio.com/2010-04-01";

interface TwilioCreds {
  accountSid: string;
  authToken: string;
}

function basicAuth({ accountSid, authToken }: TwilioCreds): string {
  return `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`;
}

function accountUrl({ accountSid }: TwilioCreds, suffix: string): string {
  return `${TWILIO_BASE}/Accounts/${encodeURIComponent(accountSid)}${suffix}`;
}

/**
 * Validate a Twilio webhook signature.
 * Algorithm (per Twilio's webhook security docs):
 *   1. Take the full URL Twilio sent the request to (including query string).
 *   2. For application/x-www-form-urlencoded bodies, sort POST keys and
 *      append each "key" + "value" to the URL string.
 *   3. HMAC-SHA1 with the account AuthToken, base64-encode.
 *   4. Timing-safe compare with the X-Twilio-Signature header.
 */
export function validateTwilioSignature(opts: {
  authToken: string;
  fullUrl: string;
  params: Record<string, string>;
  signature: string;
}): boolean {
  const { authToken, fullUrl, params, signature } = opts;
  if (!signature) return false;

  const sortedKeys = Object.keys(params).sort();
  let data = fullUrl;
  for (const key of sortedKeys) {
    data += key + params[key];
  }

  const computed = createHmac("sha1", authToken).update(data, "utf8").digest("base64");
  const a = Buffer.from(computed);
  const b = Buffer.from(signature);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export interface PlaceCallOpts extends TwilioCreds {
  to: string;
  from: string;
  twimlUrl: string;
  statusCallbackUrl?: string;
  /** Hard cap on call duration (seconds). Maps to Twilio's TimeLimit param. */
  maxDurationSec?: number;
}

export interface PlaceCallResult {
  callSid: string;
  status: string;
}

export async function placeCall(opts: PlaceCallOpts): Promise<PlaceCallResult> {
  const body = new URLSearchParams({
    To: opts.to,
    From: opts.from,
    Url: opts.twimlUrl,
    Method: "POST",
  });
  if (opts.statusCallbackUrl) {
    body.set("StatusCallback", opts.statusCallbackUrl);
    body.set("StatusCallbackMethod", "POST");
    body.append("StatusCallbackEvent", "initiated");
    body.append("StatusCallbackEvent", "answered");
    body.append("StatusCallbackEvent", "completed");
  }
  if (opts.maxDurationSec && opts.maxDurationSec > 0) {
    body.set("TimeLimit", String(opts.maxDurationSec));
  }

  const resp = await fetch(accountUrl(opts, "/Calls.json"), {
    method: "POST",
    headers: { Authorization: basicAuth(opts), "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Twilio placeCall failed: ${resp.status} ${text}`);
  }
  const data = (await resp.json()) as { sid: string; status: string };
  return { callSid: data.sid, status: data.status };
}

/** Swap the TwiML URL on an in-flight call (used to inject the real callSid into the path). */
export async function updateCallUrl(opts: TwilioCreds & { callSid: string; url: string }): Promise<void> {
  const body = new URLSearchParams({ Url: opts.url, Method: "POST" });
  const resp = await fetch(accountUrl(opts, `/Calls/${encodeURIComponent(opts.callSid)}.json`), {
    method: "POST",
    headers: { Authorization: basicAuth(opts), "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Twilio updateCallUrl failed: ${resp.status} ${text}`);
  }
}

export async function hangupCall(opts: TwilioCreds & { callSid: string }): Promise<void> {
  const body = new URLSearchParams({ Status: "completed" });
  const resp = await fetch(accountUrl(opts, `/Calls/${encodeURIComponent(opts.callSid)}.json`), {
    method: "POST",
    headers: { Authorization: basicAuth(opts), "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Twilio hangupCall failed: ${resp.status} ${text}`);
  }
}
