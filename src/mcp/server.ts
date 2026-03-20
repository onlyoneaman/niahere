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
          agent: z.string().optional().describe("Agent name to use for this job (loads agent's AGENT.md as system prompt)"),
        },
        async (args) => ({
          content: [{ type: "text" as const, text: await handlers.addJob(args) }],
        }),
      ),
      tool(
        "update_job",
        "Update an existing job's schedule, prompt, always flag, or agent. Only pass fields you want to change.",
        {
          name: z.string().describe("Job name to update"),
          schedule: z.string().optional().describe("New schedule (cron expression, interval duration, or ISO timestamp)"),
          prompt: z.string().optional().describe("New prompt"),
          always: z.boolean().optional().describe("If true, runs 24/7 ignoring active hours"),
          agent: z.string().nullable().optional().describe("Agent name (set null to remove agent)"),
        },
        async (args) => ({
          content: [{ type: "text" as const, text: await handlers.updateJob(args) }],
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
        "add_watch_channel",
        "Add or update a Slack watch channel. Watch channels receive ALL messages (not just @mentions) and act based on the behavior prompt. Takes effect on next message (hot-reloads).",
        {
          name: z.string().describe("Slack channel key as 'channel_id#channel_name', e.g. 'C1234567890#ask-kay-thread-notifications'"),
          behavior: z.string().describe("What to monitor and how to respond, e.g. 'Monitor thread notifications. Flag failures to #tech.'"),
        },
        async (args) => ({
          content: [{ type: "text" as const, text: handlers.addWatchChannel(args.name, args.behavior) }],
        }),
      ),
      tool(
        "remove_watch_channel",
        "Remove a Slack watch channel. Takes effect on next message (hot-reloads).",
        {
          name: z.string().describe("Slack channel key to stop watching (e.g. 'C1234567890#ask-kay-thread-notifications')"),
        },
        async (args) => ({
          content: [{ type: "text" as const, text: handlers.removeWatchChannel(args.name) }],
        }),
      ),
      tool(
        "enable_watch_channel",
        "Enable a disabled Slack watch channel. Takes effect on next message (hot-reloads).",
        {
          name: z.string().describe("Slack channel key to enable"),
        },
        async (args) => ({
          content: [{ type: "text" as const, text: handlers.enableWatchChannel(args.name) }],
        }),
      ),
      tool(
        "disable_watch_channel",
        "Disable a Slack watch channel without removing it. Takes effect on next message (hot-reloads).",
        {
          name: z.string().describe("Slack channel key to disable"),
        },
        async (args) => ({
          content: [{ type: "text" as const, text: handlers.disableWatchChannel(args.name) }],
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
        "read_memory",
        "Read all saved memories. Use this to check what you already know before saving duplicates, or to recall context about the owner, past incidents, preferences, etc.",
        {},
        async () => ({
          content: [{ type: "text" as const, text: handlers.readMemory() }],
        }),
      ),
      tool(
        "add_memory",
        "Save a concise factual memory for future reference. Proactively save personal facts (travel, schedule), work context (decisions, deadlines), and corrections — don't wait to be asked. RULES: Max 300 chars. One insight per entry. NO raw logs, NO transcripts, NO status dumps.",
        {
          entry: z.string().max(300).describe("A single concise insight (max 300 chars, no raw logs or transcripts)"),
        },
        async (args) => ({
          content: [{ type: "text" as const, text: handlers.addMemory(args.entry) }],
        }),
      ),
      tool(
        "list_agents",
        "List all available agents. Agents are role/domain specialists that can be delegated to via the Agent tool or referenced by jobs.",
        {},
        async () => ({
          content: [{ type: "text" as const, text: handlers.listAgents() }],
        }),
      ),
    ],
  });
}
