import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import * as handlers from "./tools";

export function createNiaMcpServer() {
  return createSdkMcpServer({
    name: "nia",
    version: "0.1.0",
    tools: [
      tool(
        "list_jobs",
        "List all scheduled jobs with status and next run time",
        {},
        async () => ({
          content: [{ type: "text" as const, text: await handlers.listJobs() }],
        }),
      ),
      tool(
        "add_job",
        "Create a new scheduled job. Supports cron expressions (0 9 * * *), interval durations (5m, 2h, 1d), or one-time ISO timestamps.",
        {
          name: z.string().describe("Unique job name"),
          schedule: z.string().describe("Cron expression, duration string, or ISO timestamp"),
          prompt: z.string().describe("What the job should do"),
          schedule_type: z.enum(["cron", "interval", "once"]).default("cron").describe("Schedule type"),
          always: z.boolean().default(false).describe("If true, runs 24/7 ignoring active hours"),
        },
        async (args) => ({
          content: [{ type: "text" as const, text: await handlers.addJob(args) }],
        }),
      ),
      tool(
        "remove_job",
        "Delete a scheduled job",
        { name: z.string().describe("Job name to remove") },
        async (args) => ({
          content: [{ type: "text" as const, text: await handlers.removeJob(args.name) }],
        }),
      ),
      tool(
        "enable_job",
        "Enable a disabled job",
        { name: z.string().describe("Job name to enable") },
        async (args) => ({
          content: [{ type: "text" as const, text: await handlers.enableJob(args.name) }],
        }),
      ),
      tool(
        "disable_job",
        "Disable a job (stops it from running)",
        { name: z.string().describe("Job name to disable") },
        async (args) => ({
          content: [{ type: "text" as const, text: await handlers.disableJob(args.name) }],
        }),
      ),
      tool(
        "run_job",
        "Trigger a job to run immediately on the next scheduler tick",
        { name: z.string().describe("Job name to run now") },
        async (args) => ({
          content: [{ type: "text" as const, text: await handlers.runJobNow(args.name) }],
        }),
      ),
      tool(
        "send_message",
        "Send a message to the user via configured channel (telegram, slack). Uses default_channel from config if not specified. Can also send a file/image by providing media_path.",
        {
          text: z.string().describe("Message text to send"),
          channel: z.string().optional().describe("Channel name (telegram, slack). Omit to use default."),
          media_path: z.string().optional().describe("Absolute path to a file to send as an attachment (image, document)"),
        },
        async (args) => ({
          content: [{ type: "text" as const, text: await handlers.sendMessage(args.text, args.channel, args.media_path) }],
        }),
      ),
      tool(
        "list_messages",
        "Read recent chat history",
        {
          limit: z.number().default(20).describe("Number of messages to return"),
          room: z.string().optional().describe("Filter by room name"),
        },
        async (args) => ({
          content: [{ type: "text" as const, text: await handlers.listMessages(args.limit, args.room) }],
        }),
      ),
      tool(
        "add_rule",
        "Add a behavioral rule. Rules are loaded into every session and take effect without restart. Use for 'from now on' / 'always' / 'never' type instructions.",
        {
          rule: z.string().describe("The rule to add (e.g. 'stamp updates: 1-2 lines max, no preamble')"),
        },
        async (args) => ({
          content: [{ type: "text" as const, text: handlers.addRule(args.rule) }],
        }),
      ),
      tool(
        "add_memory",
        "Save a factual memory for future reference. Memories are read on demand, not loaded automatically. Use for things learned, preferences discovered, or context worth keeping.",
        {
          entry: z.string().describe("What to remember (e.g. 'Aman prefers short Slack messages in #tech')"),
        },
        async (args) => ({
          content: [{ type: "text" as const, text: handlers.addMemory(args.entry) }],
        }),
      ),
    ],
  });
}
