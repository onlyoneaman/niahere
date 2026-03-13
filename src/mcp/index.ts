/** Shared MCP server config — set by daemon, read by chat engine creators. */
let _mcpServers: Record<string, unknown> | null = null;

export function setMcpServers(servers: Record<string, unknown>): void {
  _mcpServers = servers;
}

export function getMcpServers(): Record<string, unknown> | undefined {
  return _mcpServers ?? undefined;
}
