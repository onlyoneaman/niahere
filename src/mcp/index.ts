/** Factory for per-query MCP servers — each query gets its own Protocol instance. */
let _mcpFactory: (() => Record<string, unknown>) | null = null;

export function setMcpFactory(factory: () => Record<string, unknown>): void {
  _mcpFactory = factory;
}

export function getMcpServers(): Record<string, unknown> | undefined {
  return _mcpFactory?.() ?? undefined;
}
