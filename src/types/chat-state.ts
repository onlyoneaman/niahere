import type { ChatEngine } from "./engine";

export interface ChatState {
  engine: ChatEngine;
  roomIndex: number;
  lock: Promise<void>;
}
