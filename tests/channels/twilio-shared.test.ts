import { describe, expect, test } from "bun:test";
import { ackTwiml, deliveryStatusAck, isAllowedSender } from "../../src/channels/twilio/shared";
import type { TwilioConfig } from "../../src/types";

const cfg = (over: Partial<TwilioConfig> = {}): TwilioConfig =>
  ({ owner_number: "+1999", allowlist: [], ...over }) as TwilioConfig;

describe("isAllowedSender", () => {
  test("always allows the owner", () => {
    expect(isAllowedSender(cfg(), "+1999")).toBe(true);
  });

  test("allows an allowlisted sender", () => {
    expect(isAllowedSender(cfg({ allowlist: ["+1555"] }), "+1555")).toBe(true);
  });

  test("rejects anyone else", () => {
    expect(isAllowedSender(cfg({ allowlist: ["+1555"] }), "+1444")).toBe(false);
  });

  test("rejects everyone when no owner and no allowlist are configured", () => {
    expect(isAllowedSender(cfg({ owner_number: undefined, allowlist: [] }), "+1444")).toBe(false);
  });
});

describe("ackTwiml", () => {
  test("acks Twilio with empty TwiML so it does not retry", async () => {
    const res = ackTwiml();
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/xml");
    expect(await res.text()).toContain("<Response></Response>");
  });
});

describe("deliveryStatusAck", () => {
  test("acks with no content", () => {
    expect(deliveryStatusAck("sms", {}).status).toBe(204);
  });

  test("records the delivery outcome under the channel's label", () => {
    const seen: { label: string; fields: Record<string, unknown> }[] = [];
    deliveryStatusAck(
      "whatsapp",
      { MessageSid: "SM1", MessageStatus: "delivered", ErrorCode: "", To: "+1999" },
      (label, fields) => seen.push({ label, fields }),
    );
    expect(seen).toHaveLength(1);
    expect(seen[0]!.label).toBe("whatsapp");
    expect(seen[0]!.fields).toMatchObject({ messageSid: "SM1", status: "delivered", to: "+1999" });
  });
});
