import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { getPaths } from "../utils/paths";

export function loadIdentity(workspace: string): string {
  const { selfDir } = getPaths(workspace);
  const parts: string[] = [];

  const identityPath = join(selfDir, "identity.md");
  if (existsSync(identityPath)) {
    parts.push(readFileSync(identityPath, "utf8").trim());
  }

  const soulPath = join(selfDir, "soul.md");
  if (existsSync(soulPath)) {
    parts.push(readFileSync(soulPath, "utf8").trim());
  }

  return parts.join("\n\n");
}

export function buildSystemPrompt(workspace: string): string {
  const identity = loadIdentity(workspace);
  const parts: string[] = [];

  if (identity) {
    parts.push(identity);
  }

  parts.push("You are in a live chat session. Be conversational, helpful, and concise.");

  return parts.join("\n\n");
}
