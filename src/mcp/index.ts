/** Source context passed through the MCP factory so tools know who called them. */
export interface McpSourceContext {
  /** Job name if called from a job runner, e.g. "scout" */
  jobName?: string;
  /** Channel name: "slack" | "telegram" | "terminal" */
  channel?: string;
  /** The room the calling engine is operating in */
  room?: string;
}

/** Factory for per-query MCP servers — each query gets its own Protocol instance. */
let _mcpFactory: ((ctx?: McpSourceContext) => Record<string, unknown>) | null = null;

export function setMcpFactory(factory: (ctx?: McpSourceContext) => Record<string, unknown>): void {
  _mcpFactory = factory;
}

export function getMcpServers(ctx?: McpSourceContext): Record<string, unknown> | undefined {
  return _mcpFactory?.(ctx) ?? undefined;
}
