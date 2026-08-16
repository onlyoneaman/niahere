import { describe, expect, test } from "bun:test";
import { createCoalescer, mergeMessages, type Pending } from "../../src/channels/common/coalesce";

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
