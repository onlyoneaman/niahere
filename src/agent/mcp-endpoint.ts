import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { randomBytes, randomUUID } from "crypto";
import type { NiaTool } from "../mcp/tools/types";
import type { McpSourceContext } from "../mcp";
import { log } from "../utils/log";

/**
 * Loopback MCP endpoint — how out-of-process CLI backends (Codex/Gemini) reach
 * Nia's tools. The daemon hosts ONE 127.0.0.1 HTTP server; each agent run mints
 * a bearer token bound to an IMMUTABLE `McpSourceContext` snapshot and gets its
 * own MCP server instance (so `send_message` routing is frozen per run, exactly
 * like the in-process per-query closure — no shared mutable routing state, no
 * cross-run race). Tool handlers run IN the daemon process, keeping their
 * channel/phone/DB singleton access.
 *
 * Round-trip verified end-to-end against real codex 0.142.0 (see the spec).
 */

interface RunEntry {
  ctx: McpSourceContext;
  server: McpServer;
  transport: WebStandardStreamableHTTPServerTransport;
}

const runs = new Map<string, RunEntry>();
let server: ReturnType<typeof Bun.serve> | null = null;
let port = 0;
// Injected by the daemon (the composition root) so this module never imports the
// tool table — which would create a cycle (handlers → runner → agent → here).
let endpointTools: NiaTool[] = [];

/** Build a per-run MCP server whose tool closures bake in the frozen context. */
function buildRunServer(ctx: McpSourceContext, tools: NiaTool[]): McpServer {
  const mcp = new McpServer({ name: "nia", version: "0.1.0" });
  for (const t of tools) {
    mcp.registerTool(t.name, { description: t.description, inputSchema: t.schema }, async (args: unknown) => ({
      content: [{ type: "text" as const, text: await t.handler(args, ctx) }],
    }));
  }
  return mcp;
}

/** Start the loopback endpoint (idempotent). The daemon passes `NIA_TOOLS`. */
export async function startMcpEndpoint(tools: NiaTool[] = []): Promise<void> {
  endpointTools = tools;
  if (server) return;
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0, // OS-assigned ephemeral port
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname !== "/mcp") return new Response("not found", { status: 404 });
      const auth = req.headers.get("authorization") ?? "";
      const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
      const entry = runs.get(token);
      if (!entry) return new Response("unauthorized", { status: 401 });
      return entry.transport.handleRequest(req);
    },
  });
  port = server.port ?? 0;
  log.info({ port }, "mcp-endpoint: listening on loopback");
}

export function stopMcpEndpoint(): void {
  for (const token of [...runs.keys()]) revokeRun(token);
  server?.stop(true);
  server = null;
  port = 0;
}

/**
 * Mint a per-run endpoint token bound to a frozen context. Returns the URL +
 * token to hand to the CLI backend (e.g. `mcp_servers.nia.url` + a bearer env
 * var). Throws if the endpoint isn't started.
 */
export async function mintRun(ctx: McpSourceContext, tools?: NiaTool[]): Promise<{ url: string; token: string }> {
  if (!server) throw new Error("mcp-endpoint not started");
  const token = randomBytes(32).toString("base64url");
  const mcp = buildRunServer(ctx, tools ?? endpointTools);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID() });
  await mcp.connect(transport);
  runs.set(token, { ctx, server: mcp, transport });
  return { url: `http://127.0.0.1:${port}/mcp`, token };
}

/** Revoke a run's token and tear down its server/transport. Safe to call twice. */
export function revokeRun(token: string): void {
  const entry = runs.get(token);
  if (!entry) return;
  runs.delete(token);
  entry.transport.close().catch(() => {});
  entry.server.close().catch(() => {});
}

/** Test/diagnostic: number of live runs. */
export function liveRunCount(): number {
  return runs.size;
}
