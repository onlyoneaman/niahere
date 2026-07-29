import { describe, expect, test } from "bun:test";
import { gateSideEffects, SIDE_EFFECT_LIMITS } from "../../src/mcp/gate";
import type { NiaTool } from "../../src/mcp/tools/types";

function tool(name: string, calls: string[]): NiaTool {
  return {
    name,
    description: "",
    schema: {},
    handler: async (args) => {
      calls.push(`${name}:${JSON.stringify(args)}`);
      return "ok";
    },
  };
}

describe("side-effect gate", () => {
  test("leaves read-only tools alone", async () => {
    const calls: string[] = [];
    const [listJobs] = gateSideEffects([tool("list_jobs", calls)]);
    for (let i = 0; i < 50; i++) await listJobs!.handler({}, undefined);
    expect(calls).toHaveLength(50);
  });

  test("caps a side-effect tool within one run", async () => {
    const calls: string[] = [];
    const [call] = gateSideEffects([tool("place_call", calls)]);
    const limit = SIDE_EFFECT_LIMITS.place_call!;

    for (let i = 0; i < limit; i++) {
      expect(await call!.handler({ number: "+10000000000" }, undefined)).toBe("ok");
    }
    const blocked = await call!.handler({ number: "+10000000000" }, undefined);

    expect(calls).toHaveLength(limit);
    expect(blocked).toContain("limit");
  });

  test("refuses rather than throwing, so the agent can carry on", async () => {
    const [call] = gateSideEffects([tool("place_call", [])]);
    for (let i = 0; i < SIDE_EFFECT_LIMITS.place_call! + 1; i++) {
      await call!.handler({}, undefined);
    }
    // A throw would abort the whole turn; the agent should just be told no.
    expect(await call!.handler({}, undefined)).toContain("limit");
  });

  test("each run gets its own budget", async () => {
    const callsA: string[] = [];
    const callsB: string[] = [];
    const [a] = gateSideEffects([tool("place_call", callsA)]);
    const [b] = gateSideEffects([tool("place_call", callsB)]);

    for (let i = 0; i < SIDE_EFFECT_LIMITS.place_call! + 3; i++) await a!.handler({}, undefined);
    await b!.handler({}, undefined);

    expect(callsA).toHaveLength(SIDE_EFFECT_LIMITS.place_call!);
    expect(callsB).toHaveLength(1); // B is unaffected by A exhausting its budget
  });

  test("budgets are per tool, not shared across them", async () => {
    const calls: string[] = [];
    const [call, send] = gateSideEffects([tool("place_call", calls), tool("send_message", calls)]);
    for (let i = 0; i < SIDE_EFFECT_LIMITS.place_call! + 1; i++) await call!.handler({}, undefined);
    expect(await send!.handler({ text: "hi" }, undefined)).toBe("ok");
  });
});
