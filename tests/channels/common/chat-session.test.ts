import { describe, expect, test } from "bun:test";
import { chainLock } from "../../../src/channels/common/chat-session";
import type { ChatState } from "../../../src/types";

function blankState(): ChatState {
  return {
    engine: {} as any,
    roomIndex: 0,
    lock: Promise.resolve(),
  };
}

describe("chainLock", () => {
  test("serializes work submitted for the same state", async () => {
    const state = blankState();
    const order: string[] = [];

    chainLock(state, async () => {
      await new Promise((r) => setTimeout(r, 20));
      order.push("a");
    });
    chainLock(state, async () => {
      order.push("b");
    });

    await state.lock;
    expect(order).toEqual(["a", "b"]);
  });

  test("a thrown fn does not poison the next link", async () => {
    const state = blankState();
    const order: string[] = [];

    chainLock(state, async () => {
      order.push("first");
      throw new Error("boom");
    });
    chainLock(state, async () => {
      order.push("second");
    });

    await state.lock;
    expect(order).toEqual(["first", "second"]);
  });

  test("concurrent chainLock submissions still run in submission order", async () => {
    const state = blankState();
    const order: number[] = [];

    for (let i = 0; i < 10; i++) {
      chainLock(state, async () => {
        // Vary delays so a non-serial impl would interleave.
        await new Promise((r) => setTimeout(r, (10 - i) * 2));
        order.push(i);
      });
    }

    await state.lock;
    expect(order).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
});
