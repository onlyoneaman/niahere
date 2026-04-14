import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import * as handlers from "./tools";

export function createNiaMcpServer() {
  return createSdkMcpServer({
    name: "nia",
    version: "0.1.0",
    tools: [
      tool("list_jobs", "List all scheduled jobs with status and next run time", {}, async () => ({
        content: [{ type: "text" as const, text: await handlers.listJobs() }],
      })),
      tool(
        "add_job",
        "Create a new scheduled job. Supports cron expressions (0 9 * * *), interval durations (5m, 2h, 1d), or one-time ISO timestamps.",
        {
          name: z.string().describe("Unique job name"),
          schedule: z.string().describe("Cron expression, duration string, or ISO timestamp"),
          prompt: z.string().describe("What the job should do"),
          schedule_type: z.enum(["cron", "interval", "once"]).default("cron").describe("Schedule type"),
          always: z.boolean().default(false).describe("If true, runs 24/7 ignoring active hours"),
          agent: z
            .string()
            .optional()
            .describe("Agent name to use for this job (loads agent's AGENT.md as system prompt)"),
          employee: z
            .string()
            .optional()
            .describe("Employee name to use for this job (loads employee identity, runs in employee's repo)"),
          stateless: z
            .boolean()
            .default(false)
            .describe("If true, disables working memory (no state.md injection or workspace)"),
          model: z
            .string()
            .optional()
            .describe("Model override for this job (e.g. haiku, sonnet, opus). Overrides agent and global model."),
        },
        async (args) => ({
          content: [{ type: "text" as const, text: await handlers.addJob(args) }],
        }),
      ),
      tool(
        "update_job",
        "Update an existing job's schedule, prompt, always flag, agent, employee, model, stateless, or schedule_type. Only pass fields you want to change.",
        {
          name: z.string().describe("Job name to update"),
          schedule: z
            .string()
            .optional()
            .describe("New schedule (cron expression, interval duration, or ISO timestamp)"),
          prompt: z.string().optional().describe("New prompt"),
          always: z.boolean().optional().describe("If true, runs 24/7 ignoring active hours"),
          agent: z.string().nullable().optional().describe("Agent name (set null to remove agent)"),
          employee: z.string().nullable().optional().describe("Employee name (set null to remove employee)"),
          model: z.string().nullable().optional().describe("Model override (set null to remove and use default)"),
          stateless: z
            .boolean()
            .optional()
            .describe("If true, disables working memory (no state.md injection or workspace)"),
          schedule_type: z
            .enum(["cron", "interval", "once"])
            .optional()
            .describe("Schedule type (must match the schedule format)"),
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
          content: [
            {
              type: "text" as const,
              text: await handlers.removeJob(args.name),
            },
          ],
        }),
      ),
      tool(
        "enable_job",
        "Enable a disabled job",
        { name: z.string().describe("Job name to enable") },
        async (args) => ({
          content: [
            {
              type: "text" as const,
              text: await handlers.enableJob(args.name),
            },
          ],
        }),
      ),
      tool(
        "disable_job",
        "Disable a job (stops it from running)",
        { name: z.string().describe("Job name to disable") },
        async (args) => ({
          content: [
            {
              type: "text" as const,
              text: await handlers.disableJob(args.name),
            },
          ],
        }),
      ),
      tool(
        "archive_job",
        "Archive a job (out of sight, won't run). Use unarchive_job to bring it back.",
        { name: z.string().describe("Job name to archive") },
        async (args) => ({
          content: [{ type: "text" as const, text: await handlers.archiveJob(args.name) }],
        }),
      ),
      tool(
        "unarchive_job",
        "Unarchive a job back to disabled state. Use enable_job after to start running it.",
        { name: z.string().describe("Job name to unarchive") },
        async (args) => ({
          content: [{ type: "text" as const, text: await handlers.unarchiveJob(args.name) }],
        }),
      ),
      tool(
        "run_job",
        "Trigger a job to run immediately on the next scheduler tick",
        { name: z.string().describe("Job name to run now") },
        async (args) => ({
          content: [
            {
              type: "text" as const,
              text: await handlers.runJobNow(args.name),
            },
          ],
        }),
      ),
      tool(
        "send_message",
        "Send a message to the user via configured channel (telegram, slack). Uses default_channel from config if not specified. Can also send a file/image by providing media_path.",
        {
          text: z.string().describe("Message text to send"),
          channel: z.string().optional().describe("Channel name (telegram, slack). Omit to use default."),
          media_path: z
            .string()
            .optional()
            .describe("Absolute path to a file to send as an attachment (image, document)"),
        },
        async (args) => ({
          content: [
            {
              type: "text" as const,
              text: await handlers.sendMessage(args.text, args.channel, args.media_path),
            },
          ],
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
          content: [
            {
              type: "text" as const,
              text: await handlers.listMessages(args.limit, args.room),
            },
          ],
        }),
      ),
      tool(
        "list_sessions",
        "Browse past conversation sessions with previews. Returns session IDs you can pass to read_session.",
        {
          room: z.string().optional().describe("Filter by room name"),
          limit: z.number().default(10).describe("Number of sessions to return"),
        },
        async (args) => ({
          content: [
            {
              type: "text" as const,
              text: await handlers.listSessions(args.limit, args.room),
            },
          ],
        }),
      ),
      tool(
        "search_messages",
        "Search across all past messages by keyword. Returns matching messages with session IDs for deeper reading.",
        {
          query: z.string().describe("Text to search for in message content"),
          room: z.string().optional().describe("Filter by room name"),
          limit: z.number().default(20).describe("Max results to return"),
        },
        async (args) => ({
          content: [
            {
              type: "text" as const,
              text: await handlers.searchMessages(args.query, args.limit, args.room),
            },
          ],
        }),
      ),
      tool(
        "read_session",
        "Load the full transcript of a specific conversation session. Use list_sessions or search_messages to find session IDs.",
        {
          session_id: z.string().describe("Session ID to read"),
        },
        async (args) => ({
          content: [
            {
              type: "text" as const,
              text: await handlers.readSession(args.session_id),
            },
          ],
        }),
      ),
      tool(
        "add_watch_channel",
        "Add or update a Slack watch channel. Watch channels receive ALL messages (not just @mentions). Behavior is optional — if omitted, loads watches/<channel_name>/behavior.md at runtime. If a single word, it names a different watch dir. If prose (with spaces), treated as inline behavior. Takes effect on next message (hot-reloads).",
        {
          name: z
            .string()
            .describe(
              "Slack channel key as 'channel_id#channel_name', e.g. 'C1234567890#ask-kay-thread-notifications'",
            ),
          behavior: z
            .string()
            .optional()
            .describe(
              "Optional. Omit to load watches/<channel_name>/behavior.md. A single word names a different watch dir. Prose (with spaces) is inline behavior.",
            ),
        },
        async (args) => ({
          content: [
            {
              type: "text" as const,
              text: handlers.addWatchChannel(args.name, args.behavior),
            },
          ],
        }),
      ),
      tool(
        "remove_watch_channel",
        "Remove a Slack watch channel. Takes effect on next message (hot-reloads).",
        {
          name: z
            .string()
            .describe("Slack channel key to stop watching (e.g. 'C1234567890#ask-kay-thread-notifications')"),
        },
        async (args) => ({
          content: [
            {
              type: "text" as const,
              text: handlers.removeWatchChannel(args.name),
            },
          ],
        }),
      ),
      tool(
        "enable_watch_channel",
        "Enable a disabled Slack watch channel. Takes effect on next message (hot-reloads).",
        {
          name: z.string().describe("Slack channel key to enable"),
        },
        async (args) => ({
          content: [
            {
              type: "text" as const,
              text: handlers.enableWatchChannel(args.name),
            },
          ],
        }),
      ),
      tool(
        "disable_watch_channel",
        "Disable a Slack watch channel without removing it. Takes effect on next message (hot-reloads).",
        {
          name: z.string().describe("Slack channel key to disable"),
        },
        async (args) => ({
          content: [
            {
              type: "text" as const,
              text: handlers.disableWatchChannel(args.name),
            },
          ],
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
        "Save a concise factual memory for future reference. Call this when the user explicitly asks you to remember something, or when a correction needs an immediate durable record. For observations you notice on your own during a session, let the post-session consolidator handle it via staging.md — don't preemptively save here. RULES: Max 300 chars. One insight per entry. NO raw logs, NO transcripts, NO status dumps.",
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
      tool(
        "list_employees",
        "List all employees with their role, project, status, and model. Employees are persistent co-founders/team members scoped to projects.",
        {},
        async () => ({
          content: [{ type: "text" as const, text: handlers.listEmployees() }],
        }),
      ),
    ],
  });
}
