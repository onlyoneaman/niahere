import type { Attachment } from "../../types/attachment";

/**
 * One turn per burst, instead of one turn per message.
 *
 * Messages arrive in bursts — roughly a third of them land within ten seconds
 * of the one before, in every room measured. Chained one-per-turn, the agent
 * answers the first without knowing the other two exist, then answers a
 * question the sender has already moved past, at three times the cost.
 *
 * So: if nothing is running, run. If something is, hold the message until it
 * finishes and send the whole burst as a single turn. No timers — this only
 * coalesces what genuinely overlapped work, never delays a message that could
 * have been answered immediately.
 */

export interface Pending {
  text: string;
  attachments: Attachment[];
}

/**
 * How a drain gets its turn to run. Channels pass their existing per-room lock
 * so that coalesced messages and everything else that talks to the same engine
 * (`/nia <subcommand>`, for one) stay mutually exclusive. Two locks guarding one
 * engine would be a race, not a safeguard.
 */
export type Schedule = (fn: () => Promise<void>) => void;

export interface CoalescerOptions {
  /**
   * Most messages a single turn may carry. The remainder rolls into the next
   * batch rather than being dropped — a long turn can accumulate a lot, and a
   * bounded prompt is worth more than an unbounded one, but not more than the
   * sender's words.
   */
  maxBatch?: number;
  /** Defaults to serializing internally, which suits a caller with no lock. */
  schedule?: Schedule;
}

const DEFAULT_MAX_BATCH = 10;

export interface Coalescer {
  /** Offer a message. Runs now, or joins the next batch. */
  push(item: Pending): void;
  /** Resolves once nothing is queued or running. */
  idle(): Promise<void>;
}

export function createCoalescer(
  process: (batch: Pending[]) => Promise<void>,
  options: CoalescerOptions = {},
): Coalescer {
  const maxBatch = Math.max(1, options.maxBatch ?? DEFAULT_MAX_BATCH);
  const queue: Pending[] = [];
  let scheduled = false;

  // Two chains, deliberately separate. `lockChain` is the fallback scheduler for
  // a caller with no lock of its own; `idleChain` only tracks completion so
  // idle() can wait. Folding them together makes the default case circular.
  let lockChain: Promise<void> = Promise.resolve();
  let idleChain: Promise<void> = Promise.resolve();
  const schedule = options.schedule ?? ((fn) => { lockChain = lockChain.then(fn, fn); });

  function kick(): void {
    if (scheduled) return;
    scheduled = true;

    let settle!: () => void;
    const tracked = new Promise<void>((r) => (settle = r));
    idleChain = idleChain.then(() => tracked);

    schedule(async () => {
      try {
        // Released before the turn runs, so anything arriving mid-turn
        // schedules the next drain instead of being stranded behind this one.
        scheduled = false;
        const batch = queue.splice(0, maxBatch);
        if (batch.length === 0) return;
        // A turn that throws must not strand the messages queued behind it.
        await process(batch).catch(() => {});
        if (queue.length > 0) kick();
      } finally {
        settle();
      }
    });
  }

  return {
    push(item) {
      queue.push(item);
      kick();
    },
    async idle() {
      while (scheduled || queue.length > 0) await idleChain;
      await idleChain;
    },
  };
}

/**
 * Render a burst as one turn.
 *
 * A single message passes through untouched — the common case must behave
 * exactly as it did before. Several are kept verbatim and in order, under a
 * line saying how many arrived and that all of them want answering: merging
 * three redundant replies into one *incomplete* reply would be worse than the
 * behaviour it replaces.
 */
export function mergeMessages(items: Pending[]): Pending {
  const attachments = items.flatMap((i) => i.attachments ?? []);
  const parts = items.map((i) => i.text.trim()).filter((t) => t.length > 0);

  if (items.length === 1) return { text: items[0]!.text, attachments };
  if (parts.length === 0) return { text: "", attachments };
  if (parts.length === 1) return { text: parts[0]!, attachments };

  const header = `[${parts.length} messages arrived together while you were working. Answer all of them.]`;
  return { text: `${header}\n\n${parts.join("\n\n")}`, attachments };
}

/** An inbound message plus whatever the channel needs to answer it. */
export interface Inbound<C> extends Pending {
  ctx: C;
}

export interface TurnPump<K, C> {
  /** Deliver a message. Runs now, or joins the next turn for that room. */
  push(key: K, item: Inbound<C>): void;
  /** Resolves once every room has drained. Tests and shutdown. */
  idle(): Promise<void>;
  /** Forget a room's queue — call when its session is closed. */
  forget(key: K): void;
}

/**
 * One place where inbound messages become turns.
 *
 * Every message-driven channel had the same shape open-coded: take the room
 * lock, send one message, post one reply. Batching had to live wherever that
 * shape lived, so putting it in each channel would have meant four copies of
 * the trickiest part. This owns the queue and the lock; channels keep only what
 * is genuinely theirs — how to acknowledge a message, and how to post a reply.
 */
export function createTurnPump<K, C>(
  lockFor: (key: K) => Schedule,
  run: (key: K, batch: Inbound<C>[], merged: Pending) => Promise<void>,
  options: CoalescerOptions = {},
): TurnPump<K, C> {
  const queues = new Map<K, Coalescer>();

  function queueFor(key: K): Coalescer {
    let q = queues.get(key);
    if (!q) {
      q = createCoalescer(
        async (batch) => {
          await run(key, batch as Inbound<C>[], mergeMessages(batch));
        },
        { ...options, schedule: lockFor(key) },
      );
      queues.set(key, q);
    }
    return q;
  }

  return {
    push(key, item) {
      queueFor(key).push(item);
    },
    async idle() {
      await Promise.all([...queues.values()].map((q) => q.idle()));
    },
    forget(key) {
      queues.delete(key);
    },
  };
}
