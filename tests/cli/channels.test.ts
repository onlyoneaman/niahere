import { describe, expect, test } from "bun:test";
import { parseSendArgs } from "../../src/cli/channels";

describe("parseSendArgs", () => {
  test("treats --help as help, not as the message", () => {
    // `nia send --help` used to DM the literal flag.
    expect(parseSendArgs(["--help"])).toMatchObject({ help: true, message: "" });
    expect(parseSendArgs(["-h"])).toMatchObject({ help: true, message: "" });
  });

  test("a literal --help can still be sent after --", () => {
    expect(parseSendArgs(["--", "--help"])).toMatchObject({ help: false, message: "--help" });
  });

  test("parses target flags and the message", () => {
    expect(parseSendArgs(["-c", "slack", "--to", "C123", "--thread", "123.456", "hello", "there"])).toEqual({
      channel: "slack",
      toChannelId: "C123",
      threadTs: "123.456",
      message: "hello there",
      help: false,
    });
  });

  test("a bare message needs no flags", () => {
    expect(parseSendArgs(["just", "a", "message"])).toMatchObject({ message: "just a message", help: false });
  });
});
