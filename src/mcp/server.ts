import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { NIA_TOOLS } from "./tools/table";
import type { McpSourceContext } from "./index";

/**
 * In-process MCP server for the Claude Agent SDK. Maps over the single
 * `NIA_TOOLS` table so the in-process and loopback-HTTP transports stay in
 * lockstep — there is no second tool list to drift.
 */
export function createNiaMcpServer(sourceCtx?: McpSourceContext) {
  return createSdkMcpServer({
    name: "nia",
    version: "0.1.0",
    tools: NIA_TOOLS.map((t) =>
      tool(t.name, t.description, t.schema, async (args: unknown) => ({
        content: [{ type: "text" as const, text: await t.handler(args, sourceCtx) }],
      })),
    ),
  });
}
