import { existsSync } from "fs";
import { resolveCodexBin } from "./backends/codex";

/** Whether a codex backend can run on this host at all. */
export function codexAvailable(): boolean {
  return existsSync(resolveCodexBin());
}

/** Minimal spawned-process surface, injectable so the probe is unit-testable. */
export type CatalogRunner = (args: string[]) => Promise<{ stdout: string; exitCode: number }>;

const defaultRunner: CatalogRunner = async (args) => {
  const proc = Bun.spawn([resolveCodexBin(), ...args], { stdout: "pipe", stderr: "ignore" });
  const stdout = await new Response(proc.stdout).text();
  return { stdout, exitCode: await proc.exited };
};

export function parseCodexModels(stdout: string): string[] | null {
  try {
    const parsed = JSON.parse(stdout) as { models?: { slug?: unknown }[] };
    const slugs = (parsed.models ?? []).map((m) => m.slug).filter((s): s is string => typeof s === "string" && s !== "");
    return slugs.length > 0 ? slugs : null;
  } catch {
    return null;
  }
}

/**
 * Model slugs this codex install will accept. Null when the catalog cannot be
 * read — callers treat that as "unknown", never as "the model is gone", so a
 * broken probe can't manufacture a false alarm.
 */
export async function codexModelSlugs(run: CatalogRunner = defaultRunner): Promise<string[] | null> {
  try {
    const { stdout, exitCode } = await run(["debug", "models"]);
    return exitCode === 0 ? parseCodexModels(stdout) : null;
  } catch {
    return null;
  }
}
