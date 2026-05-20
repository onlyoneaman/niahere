/**
 * `consult_claude` — single-shot escape hatch from the realtime voice model
 * into Claude for memory-aware or reasoning-heavy questions. Voice agents
 * use this when a turn exceeds the seeded context.
 *
 * Heavyweight (multi-second latency) by design — keep usage selective.
 */
import Anthropic from "@anthropic-ai/sdk";
import { loadIdentity } from "../../chat/identity";
import { log } from "../../utils/log";

let _anthropic: Anthropic | null = null;
function client(): Anthropic {
  if (!_anthropic) _anthropic = new Anthropic();
  return _anthropic;
}

export async function consultClaude(question: string, callerLabel: string): Promise<string> {
  const identity = loadIdentity();
  const system = [
    identity,
    "You are answering a one-shot question from Nia's voice loop during an active phone call.",
    `Caller: ${callerLabel}.`,
    "Answer in under 60 words, conversational, no markdown. The voice model will speak your answer verbatim.",
  ]
    .filter(Boolean)
    .join("\n\n");

  try {
    const resp = await client().messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 400,
      system,
      messages: [{ role: "user", content: question }],
    });
    const block = resp.content[0];
    if (block && block.type === "text") return block.text.trim();
    return "(no answer)";
  } catch (err) {
    log.error({ err }, "phone: consult_claude failed");
    return `error consulting Claude: ${err instanceof Error ? err.message : String(err)}`;
  }
}
