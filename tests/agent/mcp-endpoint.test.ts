import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { startMcpEndpoint, stopMcpEndpoint, mintRun, revokeRun, liveRunCount } from "../../src/agent/mcp-endpoint";
import type { NiaTool } from "../../src/mcp/tools/table";
import type { McpSourceContext } from "../../src/mcp";

// A fake tool that records the frozen context it was invoked with — proves the
// per-run closure routes correctly without touching the DB.
let lastCtx: McpSourceContext | undefined;
const echoTool: NiaTool = {
  name: "echo_ctx",
  description: "Echo the calling context room",
  schema: {},
  handler: (_args, ctx) => {
    lastCtx = ctx;
    return `ECHO:${ctx?.room ?? "?"}`;
  },
};

async function callEcho(url: string, token: string): Promise<string> {
  const client = new Client({ name: "t", version: "0.0.1" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(url), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  );
  const res: any = await client.callTool({ name: "echo_ctx", arguments: {} });
  await client.close();
  return res.content?.[0]?.text;
}

beforeAll(async () => {
  await startMcpEndpoint();
});
afterAll(() => stopMcpEndpoint());

describe("mcp-endpoint", () => {
  test("round-trips a tool call with the frozen per-run context", async () => {
    const { url, token } = await mintRun({ room: "room-A", channel: "slack" }, [echoTool]);
    const out = await callEcho(url, token);
    expect(out).toBe("ECHO:room-A");
    expect(lastCtx?.room).toBe("room-A");
    revokeRun(token);
  });

  test("two runs route to their own immutable context (no cross-talk)", async () => {
    const a = await mintRun({ room: "room-1", channel: "slack" }, [echoTool]);
    const b = await mintRun({ room: "room-2", channel: "slack" }, [echoTool]);
    expect(await callEcho(b.url, b.token)).toBe("ECHO:room-2");
    expect(await callEcho(a.url, a.token)).toBe("ECHO:room-1");
    revokeRun(a.token);
    revokeRun(b.token);
  });

  test("an unknown/revoked token is rejected", async () => {
    const { url, token } = await mintRun({ room: "room-X", channel: "slack" }, [echoTool]);
    revokeRun(token);
    await expect(callEcho(url, token)).rejects.toBeDefined();
    await expect(callEcho(url, "bogus-token")).rejects.toBeDefined();
  });

  test("revoke tears down the run", async () => {
    const before = liveRunCount();
    const { token } = await mintRun({ room: "room-Y", channel: "slack" }, [echoTool]);
    expect(liveRunCount()).toBe(before + 1);
    revokeRun(token);
    expect(liveRunCount()).toBe(before);
  });
});
