import { log } from "../utils/log";

type CloseHandle = (reason: string) => void | Promise<void>;

const handles = new Map<string, CloseHandle>();

export function registerActiveHandle(room: string, close: CloseHandle): void {
  handles.set(room, close);
}

export function unregisterActiveHandle(room: string): void {
  handles.delete(room);
}

export function activeHandleCount(): number {
  return handles.size;
}

export async function closeAllActiveHandles(reason: string): Promise<number> {
  const entries = [...handles.entries()];
  for (const [room, close] of entries) {
    try {
      await close(reason);
    } catch (err) {
      log.warn({ err, room }, "failed to close active handle");
    } finally {
      handles.delete(room);
    }
  }
  return entries.length;
}
