/**
 * Read/write helpers for the persona memory file (~/.niahere/self/memory.md).
 *
 * Lives in utils/ so both the MCP tools (chat surface) and channel modules
 * (e.g. phone) can share the same validation + write semantics without
 * creating an import cycle.
 */
import { existsSync, readFileSync, appendFileSync, writeFileSync } from "fs";
import { join } from "path";
import { getPaths } from "./paths";
import { findSecret } from "./secrets";
import { searchMemoryText } from "./memory-window";

export function readMemory(): string {
  const { selfDir } = getPaths();
  const memoryPath = join(selfDir, "memory.md");
  if (!existsSync(memoryPath)) return "No memories saved yet.";
  const content = readFileSync(memoryPath, "utf8").trim();
  const lines = content.split("\n").filter((l) => l.startsWith("- ") || l.startsWith("## "));
  if (lines.length === 0) return "No memories saved yet.";
  return lines.join("\n");
}

/**
 * Append a single concise insight under today's date heading. Returns a
 * human-readable result string for the caller (MCP tool / phone tool) to
 * relay back to the model.
 */
export function addMemory(entry: string): string {
  const trimmed = entry.trim();
  if (!trimmed) return "Rejected: empty entry.";
  if (trimmed.length > 300) return "Rejected: too long (max 300 chars). Distill to a single concise insight.";
  if (trimmed.includes("[Thread context]") || trimmed.includes("[Current messag"))
    return "Rejected: no raw conversation transcripts.";
  if (trimmed.split("\n").length > 5) return "Rejected: too many lines. One concise insight per memory.";
  const secret = findSecret(trimmed);
  if (secret) return `Rejected: looks like a ${secret}. Durable memory loads into every session's prompt — put credentials in config.yaml.`;

  const { selfDir } = getPaths();
  const memoryPath = join(selfDir, "memory.md");
  const existing = existsSync(memoryPath) ? readFileSync(memoryPath, "utf8") : "";

  const date = new Date().toISOString().slice(0, 10);
  const header = `\n## ${date}`;

  if (existing.includes(header)) {
    const updated = existing.replace(header, `${header}\n- ${trimmed}`);
    writeFileSync(memoryPath, updated, "utf8");
  } else {
    appendFileSync(memoryPath, `${header}\n- ${trimmed}\n`, "utf8");
  }
  return `Memory saved.`;
}

/** Search all durable memory, including entries not loaded into this prompt. */
export function searchMemory(query: string, limit = 20): string {
  const { selfDir } = getPaths();
  const path = join(selfDir, "memory.md");
  if (!existsSync(path)) return "No memory file yet.";
  const hits = searchMemoryText(readFileSync(path, "utf8"), query, limit);
  if (hits.length === 0) return `No memory matches "${query}".`;
  return hits.map((h) => `[${h.section}] ${h.entry}`).join("\n");
}
