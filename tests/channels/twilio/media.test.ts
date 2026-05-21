import { describe, expect, test } from "bun:test";
import { extractMedia } from "../../../src/channels/twilio/media";

describe("twilio/media.extractMedia", () => {
  test("returns empty when NumMedia missing or zero", () => {
    expect(extractMedia({})).toEqual([]);
    expect(extractMedia({ NumMedia: "0" })).toEqual([]);
  });

  test("collects URL + mime pairs by index", () => {
    const params = {
      NumMedia: "2",
      MediaUrl0: "https://api.twilio.com/m0",
      MediaContentType0: "image/jpeg",
      MediaUrl1: "https://api.twilio.com/m1",
      MediaContentType1: "audio/ogg",
    };
    expect(extractMedia(params)).toEqual([
      { index: 0, url: "https://api.twilio.com/m0", mime: "image/jpeg" },
      { index: 1, url: "https://api.twilio.com/m1", mime: "audio/ogg" },
    ]);
  });

  test("skips holes (missing URL or mime)", () => {
    const params = {
      NumMedia: "2",
      MediaUrl0: "https://api.twilio.com/m0",
      MediaContentType0: "image/jpeg",
      MediaUrl1: "https://api.twilio.com/m1",
      // no MediaContentType1
    };
    expect(extractMedia(params)).toHaveLength(1);
  });

  test("handles malformed NumMedia", () => {
    expect(extractMedia({ NumMedia: "abc" })).toEqual([]);
    expect(extractMedia({ NumMedia: "-3" })).toEqual([]);
  });
});
