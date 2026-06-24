import { z } from "zod";
import * as handlers from "./index";
import type { McpSourceContext } from "../index";

/**
 * One declarative tool table, consumed by both transports:
 *  - the in-process Claude SDK server (`createNiaMcpServer`)
 *  - the loopback HTTP MCP endpoint that the CLI backends (Codex/Gemini) connect to
 *
 * Keeping a single source of truth is what makes "one tool table, two transports"
 * DRY. Handlers live in the domain modules under `src/mcp/tools/*` and are
 * untouched; only `send_message` reads the per-run `McpSourceContext`.
 */
export interface NiaTool {
  name: string;
  description: string;
  /** A zod raw shape (the object of field schemas), as the SDK `tool()` expects. */
  schema: z.ZodRawShape;
  /** Returns the user-facing text result. `ctx` is the frozen per-run routing identity. */
  handler: (args: any, ctx?: McpSourceContext) => Promise<string> | string;
}

export const NIA_TOOLS: NiaTool[] = [
  {
    name: "list_jobs",
    description: "List all scheduled jobs with status and next run time",
    schema: {},
    handler: () => handlers.listJobs(),
  },
  {
    name: "add_job",
    description:
      "Create a new scheduled job. Supports cron expressions (0 9 * * *), interval durations (5m, 2h, 1d), or one-time ISO timestamps.",
    schema: {
      name: z.string().describe("Unique job name"),
      schedule: z.string().describe("Cron expression, duration string, or ISO timestamp"),
      prompt: z
        .string()
        .describe(
          "What the job should do. A non-empty ~/.niahere/jobs/<job-name>/prompt.md overrides this database prompt at runtime.",
        ),
      schedule_type: z.enum(["cron", "interval", "once"]).default("cron").describe("Schedule type"),
      always: z.boolean().default(false).describe("If true, runs 24/7 ignoring active hours"),
      agent: z.string().optional().describe("Agent name to use for this job (loads agent's AGENT.md as system prompt)"),
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
    handler: (args) => handlers.addJob(args),
  },
  {
    name: "update_job",
    description:
      "Update an existing job's schedule, prompt, always flag, agent, employee, model, stateless, or schedule_type. Only pass fields you want to change.",
    schema: {
      name: z.string().describe("Job name to update"),
      schedule: z.string().optional().describe("New schedule (cron expression, interval duration, or ISO timestamp)"),
      prompt: z
        .string()
        .optional()
        .describe("New database prompt. A non-empty ~/.niahere/jobs/<job-name>/prompt.md overrides this at runtime."),
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
    handler: (args) => handlers.updateJob(args),
  },
  {
    name: "remove_job",
    description: "Delete a scheduled job",
    schema: { name: z.string().describe("Job name to remove") },
    handler: (args) => handlers.removeJob(args.name),
  },
  {
    name: "enable_job",
    description: "Enable a disabled job",
    schema: { name: z.string().describe("Job name to enable") },
    handler: (args) => handlers.enableJob(args.name),
  },
  {
    name: "disable_job",
    description: "Disable a job (stops it from running)",
    schema: { name: z.string().describe("Job name to disable") },
    handler: (args) => handlers.disableJob(args.name),
  },
  {
    name: "archive_job",
    description: "Archive a job (out of sight, won't run). Use unarchive_job to bring it back.",
    schema: { name: z.string().describe("Job name to archive") },
    handler: (args) => handlers.archiveJob(args.name),
  },
  {
    name: "unarchive_job",
    description: "Unarchive a job back to disabled state. Use enable_job after to start running it.",
    schema: { name: z.string().describe("Job name to unarchive") },
    handler: (args) => handlers.unarchiveJob(args.name),
  },
  {
    name: "run_job",
    description: "Trigger a job to run immediately on the next scheduler tick",
    schema: { name: z.string().describe("Job name to run now") },
    handler: (args) => handlers.runJobNow(args.name),
  },
  {
    name: "send_message",
    description:
      "Send a message via configured channel. By default sends to the current context (if in a Slack thread, replies there; otherwise DMs the owner). Use target='dm' to force a DM regardless of context, or target='thread' to explicitly reply in the current thread.",
    schema: {
      text: z.string().describe("Message text to send"),
      channel: z.string().optional().describe("Channel name (telegram, slack). Omit to use default."),
      media_path: z.string().optional().describe("Absolute path to a file to send as an attachment (image, document)"),
      target: z
        .enum(["auto", "dm", "thread"])
        .default("auto")
        .describe(
          "Where to send: 'auto' (current context — thread if in one, else DM), 'dm' (always DM the owner), 'thread' (reply in current thread)",
        ),
    },
    handler: (args, ctx) => handlers.sendMessage(args.text, args.channel, args.media_path, ctx, args.target),
  },
  {
    name: "list_messages",
    description: "Read recent chat history",
    schema: {
      limit: z.number().default(20).describe("Number of messages to return"),
      room: z.string().optional().describe("Filter by room name"),
    },
    handler: (args) => handlers.listMessages(args.limit, args.room),
  },
  {
    name: "list_sessions",
    description: "Browse past conversation sessions with previews. Returns session IDs you can pass to read_session.",
    schema: {
      room: z.string().optional().describe("Filter by room name"),
      limit: z.number().default(10).describe("Number of sessions to return"),
    },
    handler: (args) => handlers.listSessions(args.limit, args.room),
  },
  {
    name: "search_messages",
    description:
      "Search across all past messages by keyword. Returns matching messages with session IDs for deeper reading.",
    schema: {
      query: z.string().describe("Text to search for in message content"),
      room: z.string().optional().describe("Filter by room name"),
      limit: z.number().default(20).describe("Max results to return"),
    },
    handler: (args) => handlers.searchMessages(args.query, args.limit, args.room),
  },
  {
    name: "read_session",
    description:
      "Load the full transcript of a specific conversation session. Use list_sessions or search_messages to find session IDs.",
    schema: { session_id: z.string().describe("Session ID to read") },
    handler: (args) => handlers.readSession(args.session_id),
  },
  {
    name: "add_watch_channel",
    description:
      "Add or update a Slack watch channel. Watch channels receive ALL messages (not just @mentions). Behavior is optional — if omitted, loads watches/<channel_name>/behavior.md at runtime. If a single word, it names a different watch dir. If prose (with spaces), treated as inline behavior. Takes effect on next message (hot-reloads).",
    schema: {
      name: z
        .string()
        .describe("Slack channel key as 'channel_id#channel_name', e.g. 'C1234567890#ask-kay-thread-notifications'"),
      behavior: z
        .string()
        .optional()
        .describe(
          "Optional. Omit to load watches/<channel_name>/behavior.md. A single word names a different watch dir. Prose (with spaces) is inline behavior.",
        ),
    },
    handler: (args) => handlers.addWatchChannel(args.name, args.behavior),
  },
  {
    name: "remove_watch_channel",
    description: "Remove a Slack watch channel. Takes effect on next message (hot-reloads).",
    schema: {
      name: z.string().describe("Slack channel key to stop watching (e.g. 'C1234567890#ask-kay-thread-notifications')"),
    },
    handler: (args) => handlers.removeWatchChannel(args.name),
  },
  {
    name: "enable_watch_channel",
    description: "Enable a disabled Slack watch channel. Takes effect on next message (hot-reloads).",
    schema: { name: z.string().describe("Slack channel key to enable") },
    handler: (args) => handlers.enableWatchChannel(args.name),
  },
  {
    name: "disable_watch_channel",
    description: "Disable a Slack watch channel without removing it. Takes effect on next message (hot-reloads).",
    schema: { name: z.string().describe("Slack channel key to disable") },
    handler: (args) => handlers.disableWatchChannel(args.name),
  },
  {
    name: "add_rule",
    description:
      "Add a behavioral rule. Rules are loaded into every session and take effect without restart. Use for 'from now on' / 'always' / 'never' type instructions.",
    schema: { rule: z.string().describe("The rule to add (e.g. 'stamp updates: 1-2 lines max, no preamble')") },
    handler: (args) => handlers.addRule(args.rule),
  },
  {
    name: "read_memory",
    description:
      "Read all saved memories. Use this to check what you already know before saving duplicates, or to recall context about the owner, past incidents, preferences, etc.",
    schema: {},
    handler: () => handlers.readMemory(),
  },
  {
    name: "add_memory",
    description:
      "Save a concise factual memory for future reference. Call this when the user explicitly asks you to remember something, or when a correction needs an immediate durable record. For observations you notice on your own during a session, let the post-session consolidator handle it via staging.md — don't preemptively save here. RULES: Max 300 chars. One insight per entry. NO raw logs, NO transcripts, NO status dumps.",
    schema: {
      entry: z.string().max(300).describe("A single concise insight (max 300 chars, no raw logs or transcripts)"),
    },
    handler: (args) => handlers.addMemory(args.entry),
  },
  {
    name: "list_agents",
    description:
      "List all available agents. Agents are role/domain specialists that can be delegated to via the Agent tool or referenced by jobs.",
    schema: {},
    handler: () => handlers.listAgents(),
  },
  {
    name: "list_employees",
    description:
      "List all employees with their role, project, status, and model. Employees are persistent co-founders/team members scoped to projects.",
    schema: {},
    handler: () => handlers.listEmployees(),
  },
  {
    name: "place_call",
    description:
      "Place an outbound phone call. Nia dials the number, introduces herself, and pursues the stated goal. Use for appointments, vendor follow-ups, scheduled standup calls to the owner, or anything that's faster by voice than by message.",
    schema: {
      number: z.string().describe("E.164 phone number to dial (e.g. +13025551234)."),
      goal: z
        .string()
        .describe("What this call should accomplish, in plain English. Seeded into the voice agent's instructions."),
      context: z.string().optional().describe("Extra background to seed the call (calendar dump, prior notes, etc.)."),
      max_minutes: z.number().optional().describe("Hard cap on call duration in minutes (default 10, max 30)."),
      voice: z.string().optional().describe("Override the default realtime voice for this call."),
    },
    handler: (args) => handlers.placeCall(args),
  },
];
