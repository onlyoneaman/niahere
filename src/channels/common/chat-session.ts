/**
 * Shared chat-engine lifecycle helpers used by the message-driven
 * channels (telegram, slack, sms, whatsapp). Each channel keeps its
 * own `Map<senderKey, ChatState>`; these helpers cover the bits that
 * were copy-pasted between them:
 *
 *   - resolve the latest room index for a prefix and open a fresh engine
 *   - rotate to a new room (for `/reset` / `/new` / `/restart`), persisting
 *     a placeholder session so the new index survives daemon restarts
 *   - chain work onto a per-sender lock so messages from the same sender
 *     don't race
 *
 * The caller supplies a builder lambda for the EngineOptions so channels
 * that need room-aware fields (e.g. Slack's per-room `mcpServers`) can
 * compute them with the resolved room name. Channels with static options
 * just ignore the `room` argument in their builder.
 */
import { createChatEngine } from "../../chat/engine";
import { Session } from "../../db/models";
import { log } from "../../utils/log";
import type { ChatState } from "../../types";
import type { EngineOptions } from "../../types/engine";

type EngineFactory = (room: string) => Omit<EngineOptions, "room" | "resume">;

/** Open (or resume) a chat engine for `prefix`. The resulting ChatState is the caller's to cache. */
export async function openChatEngine(prefix: string, buildOpts: EngineFactory): Promise<ChatState> {
  const roomIndex = await Session.getLatestRoomIndex(prefix);
  const room = `${prefix}-${roomIndex}`;
  const opts = buildOpts(room);
  log.info({ channel: opts.channel, room }, "chat-session: opening engine");
  const engine = await createChatEngine({ ...opts, room, resume: true });
  return { engine, roomIndex, lock: Promise.resolve() };
}

/** Rotate to a fresh room. Closes `prev` if supplied, persists a placeholder Session so the index survives restarts. */
export async function rotateRoom(
  prefix: string,
  prev: ChatState | undefined,
  buildOpts: EngineFactory,
): Promise<ChatState> {
  if (prev) prev.engine.close();
  const prevIdx = await Session.getLatestRoomIndex(prefix);
  const roomIndex = prevIdx + 1;
  const room = `${prefix}-${roomIndex}`;
  await Session.create(`placeholder-${room}`, room);
  const opts = buildOpts(room);
  log.info({ channel: opts.channel, room }, "chat-session: rotated room");
  const engine = await createChatEngine({ ...opts, room, resume: false });
  return { engine, roomIndex, lock: Promise.resolve() };
}

/** Serialize `fn` onto `state.lock`. Both success and failure forward so a thrown error doesn't poison the chain. */
export function chainLock(state: ChatState, fn: () => Promise<void>): void {
  state.lock = state.lock.then(fn, fn);
}

/** Seam so the registry is testable without a database. */
export interface SessionOpener {
  open(prefix: string, build: EngineFactory): Promise<ChatState>;
  rotate(prefix: string, prev: ChatState | undefined, build: EngineFactory): Promise<ChatState>;
}

const defaultOpener: SessionOpener = { open: openChatEngine, rotate: rotateRoom };

/**
 * A channel's per-sender chat sessions. Every message-driven channel keeps one
 * of these keyed by sender, and they all want the same four things: open on
 * first use, reuse after, rotate on `/reset`, close everything on shutdown.
 */
export class ChatSessions<K> {
  private readonly states = new Map<K, ChatState>();

  constructor(
    private readonly prefixFor: (key: K) => string,
    private readonly build: EngineFactory,
    private readonly opener: SessionOpener = defaultOpener,
  ) {}

  /** `build` overrides the default options for this call — Slack needs it to
   *  thread watch behavior and thread context into a newly opened engine. */
  async get(key: K, build: EngineFactory = this.build): Promise<ChatState> {
    const existing = this.states.get(key);
    if (existing) return existing;
    const state = await this.opener.open(this.prefixFor(key), build);
    this.states.set(key, state);
    return state;
  }

  /** Start a fresh room for this sender, closing the previous one. */
  async rotate(key: K, build: EngineFactory = this.build): Promise<ChatState> {
    const state = await this.opener.rotate(this.prefixFor(key), this.states.get(key), build);
    this.states.set(key, state);
    return state;
  }

  /** The cached session, without opening one. */
  peek(key: K): ChatState | undefined {
    return this.states.get(key);
  }

  /** Whether a session is already open — Slack uses it to tell a live thread
   *  from one it should ignore. */
  has(key: K): boolean {
    return this.states.has(key);
  }

  keys(): Iterable<K> {
    return this.states.keys();
  }

  closeAll(): void {
    for (const state of this.states.values()) state.engine.close();
    this.states.clear();
  }
}
