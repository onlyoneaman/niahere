import { describe, expect, test } from "bun:test";
import { createCoalescer, createTurnPump, mergeMessages, type Pending } from "../../src/channels/common/coalesce";

/** A processor whose completion the test controls, so "in flight" is a real state. */
function gated() {
  const batches: string[][] = [];
  const releases: Array<() => void> = [];
  let active = 0;
  let maxActive = 0;
  const process = async (batch: Pending[]) => {
    active++;
    maxActive = Math.max(maxActive, active);
    batches.push(batch.map((b) => b.text));
    await new Promise<void>((r) => releases.push(r));
    active--;
  };
  const releaseNext = async () => {
    const r = releases.shift();
    if (!r) throw new Error("nothing in flight to release");
    r();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  };
  return { process, batches, releaseNext, inFlight: () => releases.length, maxActive: () => maxActive };
}

const msg = (text: string): Pending => ({ text, attachments: [] });

/** Let the scheduler actually run. A bare microtask is not enough once a drain
 *  is chained, and production messages are seconds apart regardless. */
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("createCoalescer", () => {
  test("a lone message is processed on its own, with no waiting", async () => {
    const g = gated();
    const c = createCoalescer(g.process);
    c.push(msg("one"));
    await tick();
    expect(g.batches).toEqual([["one"]]);
  });

  test("messages arriving mid-turn are delivered as ONE batch, in order", async () => {
    // The whole point: three messages during one turn become one follow-up turn.
    const g = gated();
    const c = createCoalescer(g.process);
    c.push(msg("first"));
    await tick();
    c.push(msg("second"));
    c.push(msg("third"));
    expect(g.batches).toEqual([["first"]]); // still busy — nothing new started

    await g.releaseNext();
    await tick();
    expect(g.batches).toEqual([["first"], ["second", "third"]]);
  });

  test("messages arriving during the merged batch form a third round", async () => {
    const g = gated();
    const c = createCoalescer(g.process);
    c.push(msg("a"));
    await tick();
    c.push(msg("b"));
    await g.releaseNext(); // starts [b]
    await tick();
    c.push(msg("c"));
    c.push(msg("d"));
    await g.releaseNext(); // starts [c, d]
    await tick();
    expect(g.batches).toEqual([["a"], ["b"], ["c", "d"]]);
  });

  test("never runs two batches at once", async () => {
    const g = gated();
    const c = createCoalescer(g.process);
    for (const t of ["a", "b", "c", "d", "e"]) c.push(msg(t));
    await tick();
    while (g.inFlight() > 0) {
      await g.releaseNext();
      await tick();
    }
    expect(g.maxActive()).toBe(1);
  });

  test("a failing batch does not wedge the queue", async () => {
    // A thrown turn used to be able to strand every message behind it.
    const seen: string[][] = [];
    let first = true;
    const c = createCoalescer(async (batch) => {
      seen.push(batch.map((b) => b.text));
      if (first) {
        first = false;
        throw new Error("turn blew up");
      }
    });
    c.push(msg("one"));
    await c.idle();
    c.push(msg("two"));
    await c.idle();
    expect(seen).toEqual([["one"], ["two"]]);
  });

  test("drains without ever firing an empty batch", async () => {
    const seen: string[][] = [];
    const c = createCoalescer(async (batch) => {
      seen.push(batch.map((b) => b.text));
    });
    c.push(msg("x"));
    await c.idle();
    expect(seen).toEqual([["x"]]);
    expect(seen.every((b) => b.length > 0)).toBe(true);
  });

  test("an over-long batch rolls its remainder forward rather than dropping it", async () => {
    // Bounded prompt, no lost messages — a 30-minute turn can accumulate a lot.
    const g = gated();
    const c = createCoalescer(g.process, { maxBatch: 2 });
    c.push(msg("a"));
    await tick();
    for (const t of ["b", "c", "d", "e"]) c.push(msg(t));
    await g.releaseNext();
    await tick();
    await g.releaseNext();
    await tick();
    expect(g.batches).toEqual([["a"], ["b", "c"], ["d", "e"]]);
  });

  test("idle() resolves only once everything has drained", async () => {
    const order: string[] = [];
    const c = createCoalescer(async (batch) => {
      order.push(batch.map((b) => b.text).join("+"));
    });
    c.push(msg("a"));
    await tick();
    c.push(msg("b"));
    c.push(msg("c"));
    await c.idle();
    expect(order.join(" | ")).toBe("a | b+c");
  });

  test("messages that arrive in the same tick merge — no work had started yet", () => {
    // Not a compromise: if nothing was in flight, one turn for the burst is
    // strictly better than three.
    const seen: string[][] = [];
    const c = createCoalescer(async (batch) => {
      seen.push(batch.map((b) => b.text));
    });
    c.push(msg("a"));
    c.push(msg("b"));
    c.push(msg("c"));
    return c.idle().then(() => expect(seen).toEqual([["a", "b", "c"]]));
  });
});

describe("mergeMessages", () => {
  test("a single message passes through untouched", () => {
    // The common case must be byte-identical to today, wrapper and all.
    expect(mergeMessages([msg("just one")]).text).toBe("just one");
  });

  test("several are kept verbatim, in order, and flagged as one arrival", () => {
    const out = mergeMessages([msg("check the deploy"), msg("actually the logs"), msg("and the mini")]);
    expect(out.text).toContain("3 messages");
    expect(out.text.indexOf("check the deploy")).toBeLessThan(out.text.indexOf("actually the logs"));
    expect(out.text.indexOf("actually the logs")).toBeLessThan(out.text.indexOf("and the mini"));
    for (const part of ["check the deploy", "actually the logs", "and the mini"]) {
      expect(out.text).toContain(part);
    }
  });

  test("tells the agent to answer all of them, so merging cannot swallow a question", () => {
    // Trading three redundant replies for one incomplete reply would be worse
    // than the behaviour it replaces.
    expect(mergeMessages([msg("one"), msg("two")]).text.toLowerCase()).toContain("all of them");
  });

  test("attachments combine across the batch", () => {
    const a = { type: "image", data: Buffer.from(""), mimeType: "image/png", sourcePath: "/a.png" } as never;
    const b = { type: "image", data: Buffer.from(""), mimeType: "image/png", sourcePath: "/b.png" } as never;
    const out = mergeMessages([
      { text: "one", attachments: [a] },
      { text: "two", attachments: [b] },
    ]);
    expect(out.attachments).toHaveLength(2);
  });

  test("blank messages do not become empty entries", () => {
    const out = mergeMessages([msg("real"), msg("   "), msg("also real")]);
    expect(out.text).toContain("2 messages");
    expect(out.text).not.toMatch(/\n\s*\n\s*\n/);
  });

  test("an all-blank batch still yields something sendable", () => {
    expect(typeof mergeMessages([msg("  "), msg("")]).text).toBe("string");
  });
});

describe("createCoalescer with the channel's own lock", () => {
  /** Mimics chainLock: one promise chain guarding everything on a room. */
  function lock() {
    let chain: Promise<void> = Promise.resolve();
    return {
      schedule: ((fn) => {
        chain = chain.then(fn, fn);
      }) as (fn: () => Promise<void>) => void,
      /** Something else on the same engine — e.g. `/nia <subcommand>`. */
      other(fn: () => Promise<void>) {
        chain = chain.then(fn, fn);
      },
      settled: () => chain,
    };
  }

  test("coalesced turns never overlap other work on the same engine", async () => {
    // Two locks guarding one engine would be a race. There must be exactly one.
    const l = lock();
    const order: string[] = [];
    let active = 0;
    let maxActive = 0;
    const enter = (name: string) => {
      active++;
      maxActive = Math.max(maxActive, active);
      order.push(name);
    };
    const c = createCoalescer(async (batch) => {
      enter(`turn:${batch.map((b) => b.text).join("+")}`);
      await new Promise((r) => setTimeout(r, 5));
      active--;
    }, { schedule: l.schedule });

    c.push(msg("m1"));
    await tick();
    l.other(async () => {
      enter("subcommand");
      await new Promise((r) => setTimeout(r, 5));
      active--;
    });
    c.push(msg("m2"));
    c.push(msg("m3"));

    await l.settled();
    await c.idle();
    await l.settled();

    expect(maxActive).toBe(1);
    expect(order[0]).toBe("turn:m1");
    expect(order).toContain("subcommand");
    // m2 and m3 overlapped m1, so they arrive together.
    expect(order.some((o) => o === "turn:m2+m3")).toBe(true);
  });

  test("still merges a burst when the lock is the scheduler", async () => {
    const l = lock();
    const batches: string[][] = [];
    const c = createCoalescer(async (batch) => {
      batches.push(batch.map((b) => b.text));
      await new Promise((r) => setTimeout(r, 5));
    }, { schedule: l.schedule });

    c.push(msg("a"));
    await tick();
    c.push(msg("b"));
    c.push(msg("c"));
    await c.idle();
    expect(batches).toEqual([["a"], ["b", "c"]]);
  });
});

describe("createTurnPump", () => {
  function harness() {
    const locks = new Map<string, Promise<void>>();
    const lockFor = (key: string) => (fn: () => Promise<void>) => {
      const chain = (locks.get(key) ?? Promise.resolve()).then(fn, fn);
      locks.set(key, chain);
    };
    const turns: Array<{ key: string; texts: string[]; merged: string; ctxs: string[] }> = [];
    return { lockFor, turns, locks };
  }

  const inbound = (text: string, ctx: string) => ({ text, attachments: [], ctx });

  test("each room queues independently — a busy room never blocks another", async () => {
    const h = harness();
    const pump = createTurnPump<string, string>(h.lockFor, async (key, batch, merged) => {
      h.turns.push({ key, texts: batch.map((b) => b.text), merged: merged.text, ctxs: batch.map((b) => b.ctx) });
      await new Promise((r) => setTimeout(r, 10));
    });

    pump.push("roomA", inbound("a1", "ctxA1"));
    pump.push("roomB", inbound("b1", "ctxB1"));
    await tick();
    pump.push("roomA", inbound("a2", "ctxA2"));
    await pump.idle();

    const rooms = h.turns.map((t) => t.key);
    expect(rooms.filter((r) => r === "roomA")).toEqual(["roomA", "roomA"]);
    expect(rooms.filter((r) => r === "roomB")).toEqual(["roomB"]);
  });

  test("a batch hands back every message's context, not just the last", async () => {
    // Slack needs each message's ts to clear its reaction; losing the earlier
    // ones would strand a thinking emoji forever.
    const h = harness();
    const pump = createTurnPump<string, string>(h.lockFor, async (key, batch, merged) => {
      h.turns.push({ key, texts: batch.map((b) => b.text), merged: merged.text, ctxs: batch.map((b) => b.ctx) });
      await new Promise((r) => setTimeout(r, 10));
    });

    pump.push("r", inbound("first", "ts-1"));
    await tick();
    pump.push("r", inbound("second", "ts-2"));
    pump.push("r", inbound("third", "ts-3"));
    await pump.idle();

    expect(h.turns[0]!.ctxs).toEqual(["ts-1"]);
    expect(h.turns[1]!.ctxs).toEqual(["ts-2", "ts-3"]);
    expect(h.turns[1]!.merged).toContain("2 messages");
  });

  test("the merged text for a lone message is untouched", async () => {
    const h = harness();
    const pump = createTurnPump<string, string>(h.lockFor, async (key, batch, merged) => {
      h.turns.push({ key, texts: batch.map((b) => b.text), merged: merged.text, ctxs: [] });
    });
    pump.push("r", inbound("just this", "c"));
    await pump.idle();
    expect(h.turns[0]!.merged).toBe("just this");
  });

  test("forgetting a room drops its queue without disturbing others", async () => {
    const h = harness();
    const pump = createTurnPump<string, string>(h.lockFor, async (key, batch, merged) => {
      h.turns.push({ key, texts: batch.map((b) => b.text), merged: merged.text, ctxs: [] });
    });
    pump.push("gone", inbound("x", "c"));
    await pump.idle();
    pump.forget("gone");
    pump.push("kept", inbound("y", "c"));
    await pump.idle();
    expect(h.turns.map((t) => t.key)).toEqual(["gone", "kept"]);
  });
});

describe("supersede signal", () => {
  /** A processor that records what the turn was told about its own staleness. */
  function recording(maxDeferrals?: number) {
    const seen: Array<{ texts: string[]; superseded: boolean }> = [];
    const releases: Array<() => void> = [];
    const c = createCoalescer(
      async (batch, turn) => {
        await new Promise<void>((r) => releases.push(r));
        seen.push({ texts: batch.map((b) => b.text), superseded: turn.superseded() });
      },
      maxDeferrals === undefined ? {} : { maxDeferrals },
    );
    const release = async () => {
      const r = releases.shift();
      if (!r) throw new Error("nothing in flight to release");
      r();
      await tick();
    };
    return { c, seen, release };
  }

  test("a turn nobody interrupted is not superseded", async () => {
    const r = recording();
    r.c.push(msg("only one"));
    await tick();
    await r.release();
    expect(r.seen).toEqual([{ texts: ["only one"], superseded: false }]);
  });

  test("a turn whose reply arrives after a newer message is superseded", async () => {
    // The case from prod: "i meant browser" lands mid-turn, so the answer to
    // the question it replaces must not be sent on its own.
    const r = recording();
    r.c.push(msg("check the file"));
    await tick();
    r.c.push(msg("i meant browser"));
    await r.release();
    expect(r.seen[0]).toEqual({ texts: ["check the file"], superseded: true });
  });

  test("the follow-up turn is not itself superseded when nothing more arrived", async () => {
    const r = recording();
    r.c.push(msg("first"));
    await tick();
    r.c.push(msg("second"));
    await r.release();
    await r.release();
    expect(r.seen.map((s) => s.superseded)).toEqual([true, false]);
  });

  test("deferral is capped so a steady stream still gets an answer", async () => {
    // Without a cap, a room that never goes quiet would never see a reply.
    const r = recording(2);
    r.c.push(msg("t1"));
    await tick();
    r.c.push(msg("t2"));
    await r.release();
    r.c.push(msg("t3"));
    await r.release();
    r.c.push(msg("t4"));
    await r.release();
    expect(r.seen.map((s) => s.superseded)).toEqual([true, true, false]);
  });

  test("the cap resets once a turn actually replies", async () => {
    const r = recording(1);
    r.c.push(msg("a"));
    await tick();
    r.c.push(msg("b"));
    await r.release(); // superseded (1st deferral, at the cap)
    await r.release(); // nothing pending → replies, resetting the count
    r.c.push(msg("c"));
    await tick();
    r.c.push(msg("d"));
    await r.release(); // free to defer again
    expect(r.seen.map((s) => s.superseded)).toEqual([true, false, true]);
  });

  test("the answer is decided once, so a late arrival cannot flip a sent reply", async () => {
    // The channel asks once and then sends. A message landing during delivery
    // must not retroactively turn that into a deferral.
    let control: { superseded(): boolean } | null = null;
    const releases: Array<() => void> = [];
    const c = createCoalescer(async (_batch, turn) => {
      control = turn;
      await new Promise<void>((r) => releases.push(r));
    });
    c.push(msg("x"));
    await tick();
    expect(control!.superseded()).toBe(false);
    c.push(msg("late"));
    expect(control!.superseded()).toBe(false);
    releases.shift()!();
    await tick();
  });

  test("the pump hands each room's turn its own supersede signal", async () => {
    const locks = new Map<string, Promise<void>>();
    const lockFor = (key: string) => (fn: () => Promise<void>) => {
      locks.set(key, (locks.get(key) ?? Promise.resolve()).then(fn, fn));
    };
    const seen: Array<{ key: string; superseded: boolean }> = [];
    const pump = createTurnPump<string, string>(lockFor, async (key, _batch, _merged, turn) => {
      await new Promise((r) => setTimeout(r, 5));
      seen.push({ key, superseded: turn.superseded() });
    });

    pump.push("busy", { text: "q", attachments: [], ctx: "c" });
    pump.push("quiet", { text: "q", attachments: [], ctx: "c" });
    await tick();
    pump.push("busy", { text: "correction", attachments: [], ctx: "c" });
    await pump.idle();

    expect(seen.find((s) => s.key === "quiet")!.superseded).toBe(false);
    expect(seen.filter((s) => s.key === "busy").map((s) => s.superseded)).toEqual([true, false]);
  });
});

describe("carrying a withheld reply forward", () => {
  test("a turn following a withheld reply is told the reader never saw it", async () => {
    // Without this the model reads its own undelivered answer in the
    // transcript and writes "as I mentioned above" about text nobody saw.
    const seen: boolean[] = [];
    const releases: Array<() => void> = [];
    const c = createCoalescer(async (_batch, turn) => {
      seen.push(turn.previousReplyWithheld);
      await new Promise<void>((r) => releases.push(r));
      turn.superseded();
    });
    c.push(msg("first"));
    await tick();
    c.push(msg("correction"));
    releases.shift()!();
    await tick();
    expect(seen).toEqual([false, true]);
  });

  test("a turn following a delivered reply carries no such flag", async () => {
    const seen: boolean[] = [];
    const c = createCoalescer(async (_batch, turn) => {
      seen.push(turn.previousReplyWithheld);
      turn.superseded();
    });
    c.push(msg("one"));
    await c.idle();
    c.push(msg("two"));
    await c.idle();
    expect(seen).toEqual([false, false]);
  });

  test("the pump folds the warning into the text the agent actually reads", async () => {
    const locks = new Map<string, Promise<void>>();
    const lockFor = (key: string) => (fn: () => Promise<void>) => {
      locks.set(key, (locks.get(key) ?? Promise.resolve()).then(fn, fn));
    };
    const merged: string[] = [];
    const pump = createTurnPump<string, string>(lockFor, async (_key, _batch, m, turn) => {
      await new Promise((r) => setTimeout(r, 5));
      merged.push(m.text);
      turn.superseded();
    });
    pump.push("r", { text: "check prod", attachments: [], ctx: "c" });
    await tick();
    pump.push("r", { text: "i meant staging", attachments: [], ctx: "c" });
    await pump.idle();

    expect(merged[0]).toBe("check prod");
    expect(merged[1]).toContain("i meant staging");
    expect(merged[1]!.toLowerCase()).toContain("not sent");
  });
});

describe("mergeMessages with a withheld reply", () => {
  test("says the previous reply never reached the reader", () => {
    const out = mergeMessages([msg("i meant staging")], true);
    expect(out.text.toLowerCase()).toContain("not sent");
    expect(out.text).toContain("i meant staging");
  });

  test("a lone message after a delivered reply is still byte-identical", () => {
    expect(mergeMessages([msg("just one")], false).text).toBe("just one");
    expect(mergeMessages([msg("just one")]).text).toBe("just one");
  });

  test("a burst that also follows a withheld reply reports both", () => {
    const out = mergeMessages([msg("one"), msg("two")], true);
    expect(out.text).toContain("2 messages");
    expect(out.text.toLowerCase()).toContain("not sent");
  });
});
