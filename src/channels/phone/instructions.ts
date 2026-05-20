/**
 * System-prompt builders for phone calls. The text seeded here is what the
 * realtime model treats as its instructions for the duration of the call —
 * persona on top, then call-specific behavior below.
 */
import { loadIdentity } from "../../chat/identity";

const VOICE_RULES = [
  "This is a real phone call. Speak naturally, with short turns and human rhythm.",
  "No markdown, no asterisks, no bullet points — your output is spoken aloud.",
  "Keep replies short by default. Long monologues feel robotic on phone calls.",
].join(" ");

export function buildInboundInstructions(callerLabel: string): string {
  const identity = loadIdentity();
  const callBlock = [
    `You are speaking on the phone with ${callerLabel}.`,
    VOICE_RULES,
    "When the caller asks something that needs memory or careful reasoning, call the consult_claude tool.",
    "When you've captured something worth remembering, call save_memory.",
    "When the call wraps naturally, call end_call.",
  ].join("\n");
  return [identity, callBlock].filter(Boolean).join("\n\n");
}

export function buildOutboundInstructions(goal: string, context?: string): string {
  const identity = loadIdentity();
  const callBlock = [
    "You are placing a phone call on behalf of Aman.",
    VOICE_RULES,
    `Goal: ${goal}`,
    context ? `Context:\n${context}` : "",
    "Speak first to introduce yourself and the purpose of the call.",
    "Be efficient: get to the point in the first two sentences.",
    "If you reach voicemail, leave a brief message, then call end_call.",
    "When the goal is met or the conversation is naturally complete, call end_call.",
  ]
    .filter(Boolean)
    .join("\n");
  return [identity, callBlock].filter(Boolean).join("\n\n");
}
