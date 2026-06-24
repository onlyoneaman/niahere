import type { z } from "zod";
import type { McpSourceContext } from "../index";

/**
 * Shape of one Nia tool. Kept in a leaf module (no handler imports) so both the
 * tool table and the loopback MCP endpoint can reference the type without
 * pulling the handler → scheduler → runner → agent chain into a cycle.
 */
export interface NiaTool {
  name: string;
  description: string;
  /** A zod raw shape (the object of field schemas), as the SDK `tool()` expects. */
  schema: z.ZodRawShape;
  /** Returns the user-facing text result. `ctx` is the frozen per-run routing identity. */
  handler: (args: any, ctx?: McpSourceContext) => Promise<string> | string;
}
