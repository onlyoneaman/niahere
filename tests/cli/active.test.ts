import { afterAll, beforeAll, beforeEach, describe, expect, test, spyOn } from "bun:test";
import { setupTestDb, teardownTestDb } from "../db/setup";
import { ActiveEngine } from "../../src/db/models";
import { activeCommand } from "../../src/cli/active";

const PREFIX = `test-active-${Date.now()}`;

beforeAll(async () => {
  await setupTestDb();
});

beforeEach(async () => {
  await ActiveEngine.clearAll();
});

afterAll(async () => {
  await ActiveEngine.clearAll();
  await teardownTestDb();
});

function captureLogs(): { logs: string[]; restore: () => void } {
  const logs: string[] = [];
  const spy = spyOn(console, "log").mockImplementation((message?: unknown) => {
    logs.push(String(message ?? ""));
  });
  return {
    logs,
    restore: () => spy.mockRestore(),
  };
}

describe("activeCommand", () => {
  test("prints only the active engine count by default", async () => {
    await ActiveEngine.register(`${PREFIX}-one`, "terminal");
    await ActiveEngine.register(`${PREFIX}-two`, "slack");
    const { logs, restore } = captureLogs();

    try {
      await activeCommand([]);
    } finally {
      restore();
    }

    expect(logs).toEqual(["2"]);
  });

  test("prints status-style active engine details with --full", async () => {
    await ActiveEngine.register(`${PREFIX}-full`, "terminal");
    const { logs, restore } = captureLogs();

    try {
      await activeCommand(["--full"]);
    } finally {
      restore();
    }

    expect(logs[0]).toBe("Active engines: 1");
    expect(logs[1]).toContain(`${PREFIX}-full (terminal) • started`);
    expect(logs[1]).toContain("• last ping");
  });

  test("prints none in full mode when no engines are active", async () => {
    const { logs, restore } = captureLogs();

    try {
      await activeCommand(["--full"]);
    } finally {
      restore();
    }

    expect(logs).toEqual(["Active engines: none"]);
  });
});
