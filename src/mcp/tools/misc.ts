import { appendFileSync } from "fs";
import { join } from "path";
import { getPaths } from "../../utils/paths";
import { scanAgents } from "../../core/agents";
import { listEmployeesForMcp } from "../../core/employees";
import { readMemory as readMemoryUtil, addMemory as addMemoryUtil } from "../../utils/memory";

export function addRule(rule: string): string {
  const { selfDir } = getPaths();
  const rulesPath = join(selfDir, "rules.md");
  const line = `\n- ${rule}\n`;
  appendFileSync(rulesPath, line, "utf8");
  return `Rule added to rules.md. Takes effect on next new session.`;
}

export const readMemory = readMemoryUtil;
export const addMemory = addMemoryUtil;

export function listAgents(): string {
  const agents = scanAgents();
  if (agents.length === 0) return "No agents found.";
  return JSON.stringify(
    agents.map((a) => ({
      name: a.name,
      description: a.description,
      model: a.model,
      source: a.source,
    })),
    null,
    2,
  );
}

export function listEmployees(): string {
  return listEmployeesForMcp();
}

export async function placeCall(args: {
  number: string;
  goal: string;
  context?: string;
  max_minutes?: number;
  voice?: string;
}): Promise<string> {
  // Dynamic import avoids a static cycle with channels/phone -> mcp/tools.
  const { getPhoneChannel } = await import("../../channels/phone");
  const phone = getPhoneChannel();
  if (!phone) {
    return "Phone channel is not configured. Add channels.twilio.{sid, secret, public_base_url} and channels.phone.{from_number, openai_api_key} to ~/.niahere/config.yaml (or set the matching env vars in .env), then restart the daemon.";
  }
  try {
    const result = await phone.placeCall({
      number: args.number,
      goal: args.goal,
      context: args.context,
      maxMinutes: args.max_minutes,
      voice: args.voice,
    });
    return `Call placed. callSid=${result.callSid} status=${result.status}. Transcript will land in messages once the call completes.`;
  } catch (err) {
    return `place_call failed: ${err instanceof Error ? err.message : String(err)}`;
  }
}
