import { describe, expect, test } from "bun:test";
import { reactToSlackMessage } from "../../src/channels/slack";

describe("reactToSlackMessage", () => {
  test("adds a named reaction to the source message", async () => {
    const calls: unknown[] = [];
    const client = {
      reactions: {
        add: async (args: unknown) => {
          calls.push(args);
        },
      },
    };

    await reactToSlackMessage(client, "C123", "1710000000.000000", "skull");

    expect(calls).toEqual([{ channel: "C123", timestamp: "1710000000.000000", name: "skull" }]);
  });
});
