import { describe, expect, test } from "bun:test";
import { createHmac } from "crypto";
import { streamTwiML, sayAndHangupTwiML, rejectTwiML } from "../src/channels/phone/twiml";
import { validateTwilioSignature } from "../src/channels/phone/twilio";

describe("phone/twiml", () => {
  test("streamTwiML embeds the wss URL and custom parameters", () => {
    const xml = streamTwiML("wss://example.com/twilio/voice/stream", {
      callSid: "CA123",
      direction: "outbound",
    });
    expect(xml).toContain('<Stream url="wss://example.com/twilio/voice/stream">');
    expect(xml).toContain('name="callSid" value="CA123"');
    expect(xml).toContain('name="direction" value="outbound"');
  });

  test("streamTwiML XML-escapes hostile inputs", () => {
    const xml = streamTwiML("wss://x/y", { evil: '"><script>' });
    expect(xml).not.toContain("<script>");
    expect(xml).toContain("&quot;&gt;&lt;script&gt;");
  });

  test("sayAndHangupTwiML escapes the spoken text", () => {
    const xml = sayAndHangupTwiML('test & "quote"');
    expect(xml).toContain("<Say>test &amp; &quot;quote&quot;</Say>");
    expect(xml).toContain("<Hangup/>");
  });

  test("rejectTwiML returns a minimal Reject response", () => {
    expect(rejectTwiML()).toContain("<Reject/>");
  });
});

describe("phone/twilio signature validation", () => {
  // Twilio's algorithm: HMAC-SHA1 over (url + sorted-key+value pairs), base64.
  function sign(token: string, url: string, params: Record<string, string>): string {
    let data = url;
    for (const key of Object.keys(params).sort()) data += key + params[key];
    return createHmac("sha1", token).update(data, "utf8").digest("base64");
  }

  test("accepts a correctly signed payload", () => {
    const token = "test-token";
    const url = "https://nia.example.com/twilio/voice/incoming";
    const params = { CallSid: "CA1", From: "+15551234567", To: "+13025480697" };
    const signature = sign(token, url, params);
    expect(validateTwilioSignature({ authToken: token, fullUrl: url, params, signature })).toBe(true);
  });

  test("rejects a tampered payload", () => {
    const token = "test-token";
    const url = "https://nia.example.com/twilio/voice/incoming";
    const params = { CallSid: "CA1", From: "+15551234567" };
    const signature = sign(token, url, params);
    const tampered = { ...params, From: "+18005555555" };
    expect(validateTwilioSignature({ authToken: token, fullUrl: url, params: tampered, signature })).toBe(false);
  });

  test("rejects an empty signature", () => {
    expect(validateTwilioSignature({ authToken: "t", fullUrl: "https://x", params: {}, signature: "" })).toBe(false);
  });

  test("rejects a wrong-length signature without throwing", () => {
    expect(
      validateTwilioSignature({
        authToken: "t",
        fullUrl: "https://x",
        params: {},
        signature: "shorter",
      }),
    ).toBe(false);
  });
});
