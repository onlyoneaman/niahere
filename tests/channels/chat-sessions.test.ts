import { describe, expect, test } from "bun:test";
import { ChatSessions, type SessionOpener } from "../../src/channels/common/chat-session";
import type { ChatState } from "../../src/types";

function fakeState(room: string, closed: string[]): ChatState {
  return {
    engine: { room, close: () => closed.push(room) } as unknown as ChatState["engine"],
    roomIndex: 0,
    lock: Promise.resolve(),
  };
}

/** Records what it was asked to open, so the tests assert on real calls. */
function fakeOpener(closed: string[]) {
  const opened: string[] = [];
  const rotated: string[] = [];
  const opener: SessionOpener = {
    async open(prefix) {
      opened.push(prefix);
      return fakeState(prefix, closed);
    },
    async rotate(prefix) {
      rotated.push(prefix);
      return fakeState(`${prefix}-rotated`, closed);
    },
  };
  return { opener, opened, rotated };
}

const build = () => ({ channel: "test" as const });

describe("ChatSessions", () => {
  test("opens a session on first use and reuses it after", async () => {
    const { opener, opened } = fakeOpener([]);
    const s = new ChatSessions<string>((k) => `sms-${k}`, build, opener);

    const first = await s.get("+111");
    const second = await s.get("+111");

    expect(first).toBe(second);
    expect(opened).toEqual(["sms-+111"]); // opened once, not twice
  });

  test("keeps senders apart", async () => {
    const { opener, opened } = fakeOpener([]);
    const s = new ChatSessions<string>((k) => `sms-${k}`, build, opener);

    await s.get("+111");
    await s.get("+222");

    expect(opened).toEqual(["sms-+111", "sms-+222"]);
    expect(await s.get("+111")).not.toBe(await s.get("+222"));
  });

  test("rotate replaces the cached session for that sender", async () => {
    const { opener, rotated } = fakeOpener([]);
    const s = new ChatSessions<string>((k) => `sms-${k}`, build, opener);

    const before = await s.get("+111");
    const after = await s.rotate("+111");

    expect(rotated).toEqual(["sms-+111"]);
    expect(after).not.toBe(before);
    expect(await s.get("+111")).toBe(after);
  });

  test("peek does not open anything", async () => {
    const { opener, opened } = fakeOpener([]);
    const s = new ChatSessions<string>((k) => `sms-${k}`, build, opener);

    expect(s.peek("+111")).toBeUndefined();
    expect(opened).toEqual([]);
  });

  test("closeAll closes every open engine and empties the registry", async () => {
    const closed: string[] = [];
    const { opener, opened } = fakeOpener(closed);
    const s = new ChatSessions<string>((k) => `sms-${k}`, build, opener);

    await s.get("+111");
    await s.get("+222");
    s.closeAll();

    expect(closed.sort()).toEqual(["sms-+111", "sms-+222"]);
    await s.get("+111");
    expect(opened).toEqual(["sms-+111", "sms-+222", "sms-+111"]); // reopened after close
  });

  test("supports non-string keys, as the telegram chat id needs", async () => {
    const { opener, opened } = fakeOpener([]);
    const s = new ChatSessions<number>((id) => `tg-${id}`, build, opener);
    await s.get(823887567);
    expect(opened).toEqual(["tg-823887567"]);
  });
});

describe("ChatSessions per-call options", () => {
  test("a call may override the engine options, as slack's watch context needs", async () => {
    const built: string[] = [];
    const opener: SessionOpener = {
      async open(prefix, build) {
        built.push(JSON.stringify(build(prefix)));
        return fakeState(prefix, []);
      },
      async rotate(prefix, _prev, build) {
        built.push(JSON.stringify(build(prefix)));
        return fakeState(prefix, []);
      },
    };
    const s = new ChatSessions<string>((k) => k, () => ({ channel: "slack" as const }), opener);

    await s.get("plain");
    await s.get("watched", () => ({ channel: "slack" as const, watchBehavior: { channel: "tech", behavior: "b" } }));

    expect(built[0]).not.toContain("watchBehavior");
    expect(built[1]).toContain("watchBehavior");
  });
});

describe("ChatSessions inspection", () => {
  test("has reports whether a session is already open, without opening one", async () => {
    const { opener, opened } = fakeOpener([]);
    const s = new ChatSessions<string>((k) => k, build, opener);

    expect(s.has("thread-1")).toBe(false);
    await s.get("thread-1");
    expect(s.has("thread-1")).toBe(true);
    expect(opened).toEqual(["thread-1"]); // has() never opened anything
  });

  test("keys lists the open sessions for diagnostics", async () => {
    const { opener } = fakeOpener([]);
    const s = new ChatSessions<string>((k) => k, build, opener);
    await s.get("a");
    await s.get("b");
    expect([...s.keys()].sort()).toEqual(["a", "b"]);
  });
});
