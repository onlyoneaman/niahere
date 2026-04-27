import { describe, expect, test, afterEach } from "bun:test";
import {
  activeHandleCount,
  closeAllActiveHandles,
  registerActiveHandle,
  unregisterActiveHandle,
} from "../../src/core/active-handles";

afterEach(async () => {
  await closeAllActiveHandles("test cleanup");
});

describe("active handle registry", () => {
  test("registers and unregisters handles", () => {
    registerActiveHandle("room-a", () => {});
    expect(activeHandleCount()).toBe(1);

    unregisterActiveHandle("room-a");
    expect(activeHandleCount()).toBe(0);
  });

  test("closeAllActiveHandles invokes registered close callbacks", async () => {
    const closed: string[] = [];
    registerActiveHandle("room-a", (reason) => {
      closed.push(`a:${reason}`);
    });
    registerActiveHandle("room-b", async (reason) => {
      closed.push(`b:${reason}`);
    });

    const count = await closeAllActiveHandles("force shutdown");

    expect(count).toBe(2);
    expect(closed).toEqual(["a:force shutdown", "b:force shutdown"]);
    expect(activeHandleCount()).toBe(0);
  });

  test("closeAllActiveHandles clears handles even when a callback throws", async () => {
    registerActiveHandle("room-a", () => {
      throw new Error("close failed");
    });

    const count = await closeAllActiveHandles("force shutdown");

    expect(count).toBe(1);
    expect(activeHandleCount()).toBe(0);
  });
});
