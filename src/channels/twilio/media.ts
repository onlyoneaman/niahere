/**
 * Download inbound media attached to a Twilio webhook.
 *
 * Twilio's MediaUrlN values are HTTPS URLs that 302-redirect to S3.
 * They sit behind Basic auth (same Twilio creds), so a vanilla fetch
 * without an Authorization header gets 401. Bun's fetch follows the
 * redirect transparently.
 *
 * Concurrency is bounded (4 in flight, 10s per item) so a sender that
 * attaches many large files cannot stall the webhook handler.
 */
import { log } from "../../utils/log";
import type { TwilioCreds } from "./rest";

const MAX_CONCURRENT = 4;
const TIMEOUT_MS = 10_000;

export interface InboundMedia {
  index: number;
  url: string;
  mime: string;
  data: Buffer;
}

export interface MediaDescriptor {
  index: number;
  url: string;
  mime: string;
}

/**
 * Pull out the NumMedia / MediaUrlN / MediaContentTypeN fields from a
 * Twilio webhook form body.
 */
export function extractMedia(params: Record<string, string>): MediaDescriptor[] {
  const num = parseInt(params.NumMedia || "0", 10);
  if (!Number.isFinite(num) || num <= 0) return [];
  const items: MediaDescriptor[] = [];
  for (let i = 0; i < num; i++) {
    const url = params[`MediaUrl${i}`];
    const mime = params[`MediaContentType${i}`];
    if (url && mime) items.push({ index: i, url, mime });
  }
  return items;
}

export async function downloadInboundMedia(
  descriptors: MediaDescriptor[],
  creds: TwilioCreds,
): Promise<InboundMedia[]> {
  const out: InboundMedia[] = [];
  for (let i = 0; i < descriptors.length; i += MAX_CONCURRENT) {
    const slice = descriptors.slice(i, i + MAX_CONCURRENT);
    const results = await Promise.allSettled(slice.map((d) => downloadOne(d, creds)));
    for (let j = 0; j < results.length; j++) {
      const r = results[j];
      if (r.status === "fulfilled") {
        out.push(r.value);
      } else {
        log.warn({ err: r.reason, descriptor: slice[j] }, "twilio: media download failed");
      }
    }
  }
  return out;
}

async function downloadOne(d: MediaDescriptor, creds: TwilioCreds): Promise<InboundMedia> {
  const auth = `Basic ${Buffer.from(`${creds.authSid}:${creds.authSecret}`).toString("base64")}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(d.url, { headers: { Authorization: auth }, signal: controller.signal });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const buffer = Buffer.from(await resp.arrayBuffer());
    return { index: d.index, url: d.url, mime: d.mime, data: buffer };
  } finally {
    clearTimeout(timer);
  }
}
