import { describe, expect, test } from "bun:test";
import { decideWatchReply, WATCH_JUDGEMENT_SCHEMA } from "../../src/channels/common/watch-judgement";

describe("decideWatchReply — structured", () => {
  test("a null reply is a decision to stay quiet, not a missing answer", () => {
    expect(decideWatchReply({ reply: null }, "")).toEqual({ send: false, text: "", source: "structured" });
  });

  test("a string reply is posted verbatim", () => {
    expect(decideWatchReply({ reply: "on it" }, "")).toEqual({ send: true, text: "on it", source: "structured" });
  });

  test("the sentinel loses its magic once the answer is structured", () => {
    // The whole point: content and sentinel can no longer contradict each other.
    const d = decideWatchReply({ reply: "[NO_REPLY] but actually here is the answer" }, "");
    expect(d.send).toBe(true);
    expect(d.source).toBe("structured");
  });

  test("an empty string is silence, not an empty post", () => {
    expect(decideWatchReply({ reply: "   " }, "anything")).toMatchObject({ send: false, source: "structured" });
  });
});

describe("decideWatchReply — sentinel fallback", () => {
  test("falls back when the backend produced no structured output", () => {
    expect(decideWatchReply(undefined, "here is the answer")).toEqual({
      send: true,
      text: "here is the answer",
      source: "sentinel",
    });
  });

  test("an object without the reply key is not a decision", () => {
    expect(decideWatchReply({ something: "else" }, "[NO_REPLY]").source).toBe("sentinel");
  });

  test("a bare sentinel stays quiet without complaint", () => {
    expect(decideWatchReply(null, "[NO_REPLY]")).toMatchObject({ send: false, ambiguous: false });
  });

  test("a fenced sentinel still matches", () => {
    expect(decideWatchReply(null, "`[NO_REPLY]`")).toMatchObject({ send: false, ambiguous: false });
  });

  test("sentinel mixed with content is suppressed and flagged ambiguous", () => {
    // The 47-occurrence case: the model said both, so the code has to guess.
    const d = decideWatchReply(null, "[NO_REPLY]\n\nbut here is a thought");
    expect(d).toMatchObject({ send: false, ambiguous: true, source: "sentinel" });
  });

  test("an empty answer is silence", () => {
    expect(decideWatchReply(null, "   ")).toMatchObject({ send: false, ambiguous: false });
  });
});

describe("WATCH_JUDGEMENT_SCHEMA", () => {
  test("requires reply, and allows it to be null", () => {
    expect(WATCH_JUDGEMENT_SCHEMA.required).toEqual(["reply"]);
    const props = WATCH_JUDGEMENT_SCHEMA.properties as Record<string, { type: string[] }>;
    expect(props.reply!.type).toEqual(["string", "null"]);
    expect(WATCH_JUDGEMENT_SCHEMA.additionalProperties).toBe(false);
  });
});

/**
 * Differential test against the exact logic that shipped in slack.ts before the
 * decision moved into this module. The watch path handles ~100 threads a day in
 * production, so "it looks equivalent" is not good enough.
 */
describe("sentinel path is byte-equivalent to the shipped logic", () => {
  const originalCleanSentinel = (text: string) => text.replace(/`/g, "").trim();
  const original = (result: string) => {
    const reply = result.trim();
    const cleaned = originalCleanSentinel(reply);
    if (!reply || cleaned.includes("[NO_REPLY]")) {
      const exact = !reply || cleaned === "[NO_REPLY]";
      return { send: false, text: "", ambiguous: !exact };
    }
    return { send: true, text: reply, ambiguous: false };
  };

  const corpus = [
    "",
    "   ",
    "\n\n",
    "[NO_REPLY]",
    " [NO_REPLY] ",
    "`[NO_REPLY]`",
    "```[NO_REPLY]```",
    "[NO_REPLY]\n\nbut here is a thought",
    "Sure, here's the summary.",
    "I think [NO_REPLY] applies here",
    "no reply",
    "NO_REPLY",
    "[no_reply]",
    "Deploy finished — 3 failures.",
    "line one\nline two",
    "`code` in a normal reply",
    "a reply mentioning [NO_REPLY] mid-sentence and continuing",
  ];

  for (const input of corpus) {
    test(`matches on ${JSON.stringify(input)}`, () => {
      const mine = decideWatchReply(undefined, input);
      const theirs = original(input);
      expect(mine.send).toBe(theirs.send);
      expect(mine.text).toBe(theirs.text);
      expect(mine.ambiguous ?? false).toBe(theirs.ambiguous);
    });
  }

  test("the only divergence is a log level, never a send decision", () => {
    // Both suppress — `includes` matched the sentinel inside the asterisks all
    // along. The old parse just could not tell a bold-wrapped bare sentinel
    // from one mixed with content, so it warned about a model that had done
    // nothing wrong.
    expect(original("**[NO_REPLY]**").send).toBe(false);
    expect(decideWatchReply(undefined, "**[NO_REPLY]**").send).toBe(false);

    expect(original("**[NO_REPLY]**").ambiguous).toBe(true);
    expect(decideWatchReply(undefined, "**[NO_REPLY]**").ambiguous).toBe(false);
  });
});
