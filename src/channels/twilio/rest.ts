/**
 * Minimal Twilio REST API helpers shared by all Twilio-based channels
 * (voice, SMS, WhatsApp). No SDK — keeps dependency surface small and
 * the helpers easy to read.
 *
 * Auth: Basic with `${authSid}:${authSecret}`. authSid can be either an
 * Account SID (AC…) or an API Key SID (SK…); Twilio resolves both. The
 * URL path always uses the Account SID — when using an API Key, pass
 * `accountSid` separately.
 */

const TWILIO_BASE = "https://api.twilio.com/2010-04-01";

export interface TwilioCreds {
  /** Account SID (AC…) — required for the URL path. */
  accountSid: string;
  /** SID used for Basic-auth username. Can be the same Account SID or an API Key SID (SK…). */
  authSid: string;
  /** Basic-auth password (Account Auth Token, or API Key Secret if authSid is SK…). */
  authSecret: string;
}

function basicAuth({ authSid, authSecret }: TwilioCreds): string {
  return `Basic ${Buffer.from(`${authSid}:${authSecret}`).toString("base64")}`;
}

function accountUrl({ accountSid }: TwilioCreds, suffix: string): string {
  return `${TWILIO_BASE}/Accounts/${encodeURIComponent(accountSid)}${suffix}`;
}

async function twilioPost<T = unknown>(creds: TwilioCreds, suffix: string, body: URLSearchParams): Promise<T> {
  const resp = await fetch(accountUrl(creds, suffix), {
    method: "POST",
    headers: { Authorization: basicAuth(creds), "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    signal: AbortSignal.timeout(15_000),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Twilio ${suffix} failed: ${resp.status} ${text}`);
  }
  return (await resp.json()) as T;
}

// --- Voice ---

export interface PlaceCallOpts extends TwilioCreds {
  to: string;
  from: string;
  twimlUrl: string;
  statusCallbackUrl?: string;
  maxDurationSec?: number;
}

export interface PlaceCallResult {
  callSid: string;
  status: string;
}

export async function placeCall(opts: PlaceCallOpts): Promise<PlaceCallResult> {
  const body = new URLSearchParams({ To: opts.to, From: opts.from, Url: opts.twimlUrl, Method: "POST" });
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
  const data = await twilioPost<{ sid: string; status: string }>(opts, "/Calls.json", body);
  return { callSid: data.sid, status: data.status };
}

export async function updateCallUrl(opts: TwilioCreds & { callSid: string; url: string }): Promise<void> {
  const body = new URLSearchParams({ Url: opts.url, Method: "POST" });
  await twilioPost(opts, `/Calls/${encodeURIComponent(opts.callSid)}.json`, body);
}

export async function hangupCall(opts: TwilioCreds & { callSid: string }): Promise<void> {
  const body = new URLSearchParams({ Status: "completed" });
  await twilioPost(opts, `/Calls/${encodeURIComponent(opts.callSid)}.json`, body);
}

// --- Messages (SMS / WhatsApp) ---

export interface SendMessageOpts extends TwilioCreds {
  /** E.164 for SMS, "whatsapp:+E164" for WhatsApp. */
  to: string;
  from: string;
  body: string;
  statusCallbackUrl?: string;
  /** Optional MMS media URLs. */
  mediaUrl?: string[];
}

export interface SendMessageResult {
  messageSid: string;
  status: string;
}

export async function sendMessage(opts: SendMessageOpts): Promise<SendMessageResult> {
  const body = new URLSearchParams({ To: opts.to, From: opts.from, Body: opts.body });
  if (opts.statusCallbackUrl) body.set("StatusCallback", opts.statusCallbackUrl);
  if (opts.mediaUrl) {
    for (const u of opts.mediaUrl) body.append("MediaUrl", u);
  }
  const data = await twilioPost<{ sid: string; status: string }>(opts, "/Messages.json", body);
  return { messageSid: data.sid, status: data.status };
}

// --- Phone number config (update inbound webhook on a number) ---

export async function updateIncomingPhoneNumber(
  opts: TwilioCreds & {
    phoneNumberSid: string;
    voiceUrl?: string;
    voiceMethod?: "GET" | "POST";
    smsUrl?: string;
    smsMethod?: "GET" | "POST";
    statusCallback?: string;
    statusCallbackMethod?: "GET" | "POST";
  },
): Promise<void> {
  const body = new URLSearchParams();
  if (opts.voiceUrl !== undefined) body.set("VoiceUrl", opts.voiceUrl);
  if (opts.voiceMethod) body.set("VoiceMethod", opts.voiceMethod);
  if (opts.smsUrl !== undefined) body.set("SmsUrl", opts.smsUrl);
  if (opts.smsMethod) body.set("SmsMethod", opts.smsMethod);
  if (opts.statusCallback !== undefined) body.set("StatusCallback", opts.statusCallback);
  if (opts.statusCallbackMethod) body.set("StatusCallbackMethod", opts.statusCallbackMethod);
  await twilioPost(opts, `/IncomingPhoneNumbers/${encodeURIComponent(opts.phoneNumberSid)}.json`, body);
}
