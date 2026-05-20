/**
 * Tool definitions exposed to the realtime voice model during a call.
 * Each tool is a function the model can invoke mid-conversation; the result
 * is fed back into the response so the model can speak it.
 */
import { log } from "../../utils/log";
import { addMemory } from "../../utils/memory";
import { getChannel } from "../registry";
import { consultClaude } from "./consult";
import type { PhoneToolDefinition } from "./relay";

interface ToolContextOpts {
  /** Display name of the remote party (owner, contact, or raw number). */
  callerLabel: string;
}

export function buildPhoneTools(ctx: ToolContextOpts): PhoneToolDefinition[] {
  return [
    {
      name: "consult_claude",
      description:
        "Ask Claude a question that needs memory, careful reasoning, or up-to-date context (e.g. 'what did I say about X last week?', 'should I interrupt Aman now?'). Returns a concise answer you can speak.",
      parameters: {
        type: "object",
        properties: {
          question: { type: "string", description: "The question to ask, in plain English." },
        },
        required: ["question"],
      },
      handler: async (args) => {
        const question = String(args.question || "");
        if (!question.trim()) return "(no question provided)";
        return await consultClaude(question, ctx.callerLabel);
      },
    },
    {
      name: "send_telegram",
      description:
        "Send a short message to the owner's Telegram (e.g. a summary of the call, an action item). Use sparingly — only when something needs to land outside the call.",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "Message to send. Keep it under 400 chars." },
        },
        required: ["text"],
      },
      handler: async (args) => {
        const text = String(args.text || "").slice(0, 1000);
        const tg = getChannel("telegram");
        if (!tg || !tg.sendMessage) return "telegram unavailable";
        await tg.sendMessage(`[Phone] ${text}`);
        return "sent";
      },
    },
    {
      name: "save_memory",
      description:
        "Save a single concise insight to long-term memory (max 300 chars). Use for facts or preferences worth remembering across sessions.",
      parameters: {
        type: "object",
        properties: {
          entry: { type: "string", description: "One sentence, no transcripts." },
        },
        required: ["entry"],
      },
      handler: async (args) => addMemory(String(args.entry || "")),
    },
    {
      name: "end_call",
      description: "Politely end the call after a short goodbye. Use when the conversation is naturally complete.",
      parameters: {
        type: "object",
        properties: {
          reason: { type: "string", description: "Why the call is ending (logged, not spoken)." },
        },
      },
      handler: async (args) => {
        log.info({ reason: args.reason }, "phone: end_call invoked");
        return "ending call";
      },
    },
  ];
}
