import type { TwilioConfig } from "../../types";
import { log } from "../../utils/log";

/** Bits every Twilio-backed channel (sms, whatsapp) needs identically. */

const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

/** Ack an inbound webhook immediately. Replies go out over REST instead, so a
 *  slow engine cannot blow Twilio's ~15s webhook budget. */
export function ackTwiml(): Response {
  return new Response(EMPTY_TWIML, { status: 200, headers: { "Content-Type": "text/xml" } });
}

export function isAllowedSender(twilio: TwilioConfig, remoteE164: string): boolean {
  if (twilio.owner_number && remoteE164 === twilio.owner_number) return true;
  return twilio.allowlist.includes(remoteE164);
}

type StatusLogger = (label: string, fields: Record<string, unknown>) => void;

const logStatus: StatusLogger = (label, fields) => log.info(fields, `${label}: delivery status`);

/** Record a delivery-status callback and ack it. */
export function deliveryStatusAck(
  label: string,
  params: Record<string, string>,
  record: StatusLogger = logStatus,
): Response {
  record(label, {
    messageSid: params.MessageSid,
    status: params.MessageStatus,
    errorCode: params.ErrorCode,
    to: params.To,
  });
  return new Response("", { status: 204 });
}
