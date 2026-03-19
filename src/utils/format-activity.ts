/**
 * Shared formatting utilities for SDK activity messages.
 * Used by both the chat engine and the job runner for live activity display.
 */

export function truncate(s: string, max: number): string {
  const oneline = s.replace(/\n/g, " ").trim();
  return oneline.length > max ? oneline.slice(0, max) + "…" : oneline;
}

function basename(path: string): string {
  return path.split("/").pop() || path;
}

export function formatToolUse(tool: string, input: any): string {
  if (!input || typeof input !== "object") return tool.toLowerCase();

  switch (tool) {
    // File operations
    case "Bash":
      return input.description
        ? truncate(input.description, 60)
        : input.command ? `$ ${truncate(input.command, 55)}` : "running command";
    case "Read":
      return input.file_path ? `reading ${basename(input.file_path)}` : "reading file";
    case "Edit":
      return input.file_path ? `editing ${basename(input.file_path)}` : "editing file";
    case "Write":
      return input.file_path ? `writing ${basename(input.file_path)}` : "writing file";
    case "NotebookEdit":
      return input.file_path ? `editing notebook ${basename(input.file_path)}` : "editing notebook";

    // Search operations
    case "Grep":
      return input.pattern ? `searching for "${truncate(input.pattern, 35)}"` : "searching code";
    case "Glob":
      return input.pattern ? `finding ${truncate(input.pattern, 40)}` : "finding files";
    case "ToolSearch":
      return input.query ? `looking up tool: ${truncate(input.query, 40)}` : "searching tools";

    // Agent & task operations
    case "Agent":
      return input.description ? `⟩ ${truncate(input.description, 55)}` : "running agent";
    case "Task":
      return input.description || input.prompt?.slice(0, 50) || "running task";
    case "TaskCreate":
      return input.description ? `starting: ${truncate(input.description, 45)}` : "creating task";
    case "TaskGet":
    case "TaskOutput":
      return "checking task progress";
    case "TaskList":
      return "listing tasks";
    case "TaskStop":
      return "stopping task";
    case "TaskUpdate":
      return "updating task";
    case "SendMessage":
      return input.to ? `messaging ${truncate(String(input.to), 30)}` : "sending message";

    // Web operations
    case "WebFetch":
      return input.url ? `fetching ${truncate(input.url, 50)}` : "fetching url";
    case "WebSearch":
      return input.query ? `web search: ${truncate(input.query, 40)}` : "searching the web";

    // Planning & workflow
    case "EnterPlanMode":
      return "entering plan mode";
    case "ExitPlanMode":
      return "exiting plan mode";
    case "EnterWorktree":
      return "creating worktree";
    case "ExitWorktree":
      return "leaving worktree";

    // Skill & todo
    case "Skill":
      return input.skill ? `using /${truncate(input.skill, 40)}` : "invoking skill";
    case "TodoWrite":
    case "TodoRead":
      return tool === "TodoWrite" ? "updating checklist" : "reading checklist";

    // LSP
    case "LSP":
      return input.command ? `lsp: ${truncate(input.command, 50)}` : "querying language server";

    // MCP tools (plugin_name__tool_name pattern)
    default: {
      if (tool.startsWith("mcp__")) {
        const parts = tool.split("__");
        const action = parts[parts.length - 1]?.replace(/_/g, " ") || tool;
        const val = input.url || input.selector || input.text || input.value || "";
        return val ? `${action}: ${truncate(String(val), 40)}` : action;
      }
      const val = input.description || input.command || input.pattern || input.query || input.file_path || "";
      return val ? `${tool.toLowerCase()}: ${truncate(String(val), 50)}` : tool.toLowerCase();
    }
  }
}
