# MCP Server + Enhanced Scheduling + send_message

## Overview

Add a background MCP server to the nia daemon that gives agents native tools for job management, messaging, and chat history — replacing the current pattern of agents running `nia job ...` shell commands.

## Architecture

```
nia daemon (nia start / nia run)
├── MCP Server (HTTP on 127.0.0.1:random-port)
│   ├── list_jobs
│   ├── add_job
│   ├── remove_job
│   ├── enable_job / disable_job
│   ├── run_job
│   ├── send_message
│   └── list_messages
├── Unified Scheduler (60s poll loop, next_run_at based)
├── Channels (Telegram, ...)
└── PostgreSQL
```

All SDK `query()` calls (terminal chat, telegram chat) include:
```typescript
mcpServers: { nia: { url: `http://127.0.0.1:${port}/mcp` } }
```

## MCP Server

### Transport & Security

- HTTP on `127.0.0.1:0` (OS-assigned random port)
- Port written to `~/.niahere/tmp/mcp-port` on startup, removed on shutdown
- No auth — localhost-only personal tool, same trust boundary as the daemon
- Runs inside the daemon process (not a separate subprocess)

### Implementation

Use `@modelcontextprotocol/sdk` to create the server:

```typescript
// src/mcp/server.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
```

The MCP server imports DB models directly (same process) and calls a shared `sendToTelegram()` function for messaging.

### Tools

#### `list_jobs`
- **Input**: none
- **Output**: JSON array of jobs with name, schedule, schedule_type, prompt, enabled, always, next_run_at

#### `add_job`
- **Input**: `name` (string), `schedule` (string), `prompt` (string), `schedule_type` ("cron" | "interval" | "once", default "cron"), `always` (boolean, default false)
- **Output**: confirmation message
- Schedule formats:
  - cron: standard cron expression (`0 9 * * *`)
  - interval: duration string (`5m`, `2h`, `30s`, `1d`)
  - once: ISO timestamp (`2026-03-13T18:00:00`) or relative (`in 30m`, `in 2h`)
- Triggers pg_notify for daemon reload

#### `remove_job`
- **Input**: `name` (string)
- **Output**: confirmation or "not found"

#### `enable_job` / `disable_job`
- **Input**: `name` (string)
- **Output**: confirmation

#### `run_job`
- **Input**: `name` (string)
- **Output**: confirmation that job was queued (non-blocking — doesn't wait for completion)

#### `send_message`
- **Input**: `text` (string), `channel` (string, default "telegram")
- **Output**: confirmation
- Calls `sendToTelegram(text)` — a function exported from the telegram channel module
- Uses `bot.api.sendMessage(chatId, text)` with the configured `telegram_chat_id`
- Stores message in `messages` table (sender: "nia", is_from_agent: true)
- Falls back gracefully if Telegram not configured

#### `list_messages`
- **Input**: `limit` (number, default 20), `room` (string, optional)
- **Output**: JSON array of recent messages with sender, content, timestamp

## Enhanced Scheduling

### Current State

- `node-cron` schedules each enabled job individually
- Cron expressions only
- pg_notify triggers full reload (stop all cron tasks, re-schedule)

### New State: Unified Scheduler Loop

Replace per-job node-cron with a single 60-second poll loop:

```typescript
// Pseudocode
async function schedulerTick() {
  const dueJobs = await sql`
    SELECT * FROM jobs
    WHERE enabled = TRUE AND next_run_at <= NOW()
  `;

  for (const job of dueJobs) {
    // Skip if outside active hours (unless always=true)
    if (!job.always && !isWithinActiveHours()) continue;

    // Run job (fire and forget — runner handles state)
    runJob(job);

    // Compute and store next_run_at
    const nextRun = computeNextRun(job);
    if (nextRun) {
      await sql`UPDATE jobs SET next_run_at = ${nextRun}, last_run_at = NOW() WHERE name = ${job.name}`;
    } else {
      // once-type: disable after execution
      await sql`UPDATE jobs SET enabled = FALSE, last_run_at = NOW() WHERE name = ${job.name}`;
    }
  }
}

setInterval(schedulerTick, 60_000);
schedulerTick(); // run immediately on start
```

### Schedule Types

| Type | `schedule` column | `next_run_at` computation |
|------|------------------|--------------------------|
| `cron` | cron expression (`0 9 * * *`) | Parse with cron-parser, get next occurrence |
| `interval` | duration string (`5m`, `2h`) | `last_run_at + parseDuration(schedule)` |
| `once` | ISO timestamp | The timestamp itself; disable after run |

### Duration Parsing

Simple parser for interval strings:
- `30s` → 30,000 ms
- `5m` → 300,000 ms
- `2h` → 7,200,000 ms
- `1d` → 86,400,000 ms

### Restart Recovery

On daemon startup:
- Overdue `once` jobs (next_run_at in the past, still enabled): run immediately
- Overdue `interval` jobs: run immediately, then resume normal interval
- `cron` jobs: compute next occurrence from now (skip missed runs)

### DB Migration (006)

```sql
ALTER TABLE jobs ADD COLUMN schedule_type TEXT DEFAULT 'cron';
ALTER TABLE jobs ADD COLUMN next_run_at TIMESTAMPTZ;
ALTER TABLE jobs ADD COLUMN last_run_at TIMESTAMPTZ;

-- Backfill: compute next_run_at for existing cron jobs
-- (done in TypeScript migration code using cron-parser)
```

### Job Model Changes

Add to `Job` interface:
- `scheduleType: "cron" | "interval" | "once"`
- `nextRunAt: string | null`
- `lastRunAt: string | null`

Update `create()` to accept schedule_type and compute initial `next_run_at`.

## send_message Integration

### Shared Function

The Telegram channel exports a `sendToTelegram()` function:

```typescript
// src/channels/telegram.ts — new export
let telegramSender: ((text: string) => Promise<void>) | null = null;

export function setSender(fn: (text: string) => Promise<void>): void {
  telegramSender = fn;
}

export async function sendToTelegram(text: string): Promise<void> {
  if (!telegramSender) throw new Error("Telegram not configured");
  await telegramSender(text);
}
```

The TelegramChannel class calls `setSender()` during `start()` with a closure that has access to `bot.api` and `outboundChatId`.

The MCP server's `send_message` tool calls `sendToTelegram()` and also stores the message in the DB.

## Chat Engine Changes

`createChatEngine()` accepts an optional `mcpPort` parameter:

```typescript
if (mcpPort) {
  options.mcpServers = {
    nia: { url: `http://127.0.0.1:${mcpPort}/mcp` },
  };
}
```

The daemon passes the MCP port when creating engines.

## System Prompt Changes

Remove the CLI-based job management docs from the system prompt. Replace with:

```
## Managing Jobs

You have MCP tools for job management. Use them directly:
- list_jobs: see all scheduled jobs
- add_job: create a new job (supports cron, interval, once schedules)
- remove_job: delete a job
- enable_job / disable_job: toggle a job
- run_job: trigger a job immediately
- send_message: send a message to the user via Telegram
- list_messages: read recent chat history
```

## Dependencies

Add: `@modelcontextprotocol/sdk`, `cron-parser`

## Files to Create/Modify

### New Files
- `src/mcp/server.ts` — MCP server setup, tool registration, HTTP listener
- `src/mcp/tools.ts` — tool handler implementations
- `src/utils/duration.ts` — duration string parser
- `src/db/migrations/006_jobs_scheduling.ts` — add schedule_type, next_run_at, last_run_at

### Modified Files
- `src/core/daemon.ts` — start MCP server, replace node-cron with poll loop
- `src/channels/telegram.ts` — export sendToTelegram/setSender
- `src/chat/engine.ts` — accept mcpPort, pass to query options
- `src/chat/identity.ts` — update system prompt (MCP tools instead of CLI docs)
- `src/db/models/job.ts` — add schedule_type, next_run_at, last_run_at fields
- `src/cli/job.ts` — update add command to accept --type flag
- `package.json` — add @modelcontextprotocol/sdk, cron-parser deps

### Test Files
- `tests/utils/duration.test.ts` — duration parsing
- `tests/mcp/tools.test.ts` — tool handlers (mock DB)
- `tests/core/scheduler.test.ts` — scheduler tick logic
