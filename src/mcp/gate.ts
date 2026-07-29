import type { NiaTool } from "./tools/types";
import { log } from "../utils/log";

/**
 * Per-run budget for tools with real-world consequences.
 *
 * The CLI backends run with their own approvals bypassed, and that flag governs
 * only their built-ins (shell, file writes) — nothing upstream of Nia limits how
 * often an agent may dial a phone or message the owner. Wrapping the table at
 * the point each per-run server is built puts one cap in front of every
 * backend, in-process Claude included.
 *
 * These are runaway stops, not permission checks: a looping agent burns its
 * budget and is told no, while a run doing the job it was asked to do never
 * reaches them.
 */
export const SIDE_EFFECT_LIMITS: Record<string, number> = {
  place_call: 3,
  send_message: 25,
};

/**
 * Wrap side-effect tools with a budget. Call once per run — the counters live in
 * the returned closures, so two concurrent runs cannot spend each other's.
 */
export function gateSideEffects(tools: NiaTool[]): NiaTool[] {
  const used = new Map<string, number>();

  return tools.map((t) => {
    const limit = SIDE_EFFECT_LIMITS[t.name];
    if (limit === undefined) return t;

    return {
      ...t,
      handler: async (args: any, ctx) => {
        const spent = used.get(t.name) ?? 0;
        if (spent >= limit) {
          log.warn({ tool: t.name, limit }, "side-effect tool budget exhausted for this run");
          return `Refused: ${t.name} has already run ${limit} times in this run, which is its limit. Ask the owner if you genuinely need more.`;
        }
        used.set(t.name, spent + 1);
        return t.handler(args, ctx);
      },
    };
  });
}
