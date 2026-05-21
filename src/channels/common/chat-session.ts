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
