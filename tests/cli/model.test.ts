import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, rmSync, readFileSync } from "fs";
import { modelCommand } from "../../src/cli/model";
import { resetConfig } from "../../src/utils/config";

const TEST_DIR = "/tmp/test-nia-model-cli";

beforeEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
  mkdirSync(TEST_DIR, { recursive: true });
  process.env.NIA_HOME = TEST_DIR;
  resetConfig();
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
  delete process.env.NIA_HOME;
  resetConfig();
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

describe("modelCommand", () => {
  test("prints the current global model", async () => {
    const { logs, restore } = captureLogs();

    try {
      await modelCommand([]);
    } finally {
      restore();
    }

    expect(logs).toEqual(["model = default"]);
  });

  test("sets the global model in config.yaml", async () => {
    const { logs, restore } = captureLogs();

    try {
      await modelCommand(["sonnet"]);
    } finally {
      restore();
    }

    expect(logs).toEqual(["model = sonnet"]);
    expect(readFileSync(`${TEST_DIR}/config.yaml`, "utf8")).toContain("model: sonnet");
  });
});
