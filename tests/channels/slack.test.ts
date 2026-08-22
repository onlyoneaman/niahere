import { describe, expect, test } from "bun:test";
import { reactToSlackMessage, SocketLiveness } from "../../src/channels/slack";

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

describe("SocketLiveness", () => {
  const fakeClient = () => {
    const listeners = new Map<string, Array<() => void>>();
    return {
      on(event: string, listener: () => void) {
        listeners.set(event, [...(listeners.get(event) ?? []), listener]);
      },
      emit(event: string) {
        for (const listener of listeners.get(event) ?? []) listener();
      },
    };
  };

  test("a socket that never started is not yet stalled", () => {
    expect(new SocketLiveness(fakeClient()).stalled()).toBe(false);
  });

  test("a connected socket stays healthy no matter how long it stays up", () => {
    const client = fakeClient();
    const liveness = new SocketLiveness(client);
    client.emit("connecting");
    client.emit("connected");
    expect(liveness.stalled(Date.now() + 86_400_000)).toBe(false);
  });

  test("a brief reconnect is not a stall", () => {
    const client = fakeClient();
    const liveness = new SocketLiveness(client);
    client.emit("connected");
    client.emit("reconnecting");
    expect(liveness.stalled(Date.now() + 10_000)).toBe(false);
  });

  test("a reconnect that never lands is a stall", () => {
    const client = fakeClient();
    const liveness = new SocketLiveness(client);
    client.emit("connected");
    client.emit("reconnecting");
    expect(liveness.stalled(Date.now() + 10 * 60_000)).toBe(true);
  });

  test("reconnecting clears the stall", () => {
    const client = fakeClient();
    const liveness = new SocketLiveness(client);
    client.emit("connected");
    client.emit("reconnecting");
    client.emit("connected");
    expect(liveness.stalled(Date.now() + 10 * 60_000)).toBe(false);
  });

  test("repeated failed attempts date the stall from the first one", () => {
    const client = fakeClient();
    const liveness = new SocketLiveness(client);
    client.emit("connected");
    client.emit("reconnecting");
    client.emit("connecting");
    client.emit("reconnecting");
    expect(liveness.stalled(Date.now() + 10 * 60_000)).toBe(true);
  });
});
