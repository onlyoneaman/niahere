/**
 * Validate Twilio's X-Twilio-Signature header.
 *
 * Algorithm (per Twilio webhook security docs):
 *   1. Take the full URL Twilio sent the request to (including ?query).
 *   2. For application/x-www-form-urlencoded bodies, sort POST keys and
 *      append each "key" + "value" to the URL string.
 *   3. HMAC-SHA1 with the account AuthToken, base64-encode.
 *   4. Timing-safe compare with the X-Twilio-Signature header.
 *
 * Signed with the account-level Auth Token, NOT the API Key Secret.
 * When an API Key is used for REST auth, set TWILIO_AUTH_TOKEN separately.
 */
import { createHmac, timingSafeEqual } from "crypto";

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
