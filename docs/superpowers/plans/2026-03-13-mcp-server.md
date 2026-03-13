# MCP Server + Enhanced Scheduling Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a background MCP server to the nia daemon with tools for job management, messaging, and chat history, plus enhanced scheduling (interval/once).

**Architecture:** MCP server runs inside the daemon process on HTTP localhost. All SDK query() calls connect to it via mcpServers config. Replaces node-cron with a unified 60s poll loop using next_run_at column.

**Tech Stack:** @modelcontextprotocol/sdk, cron-parser, Bun, TypeScript, PostgreSQL

---

## File Structure

| File | Responsibility |
|------|---------------|
| `src/utils/duration.ts` | Parse duration strings (`5m`, `2h`) to milliseconds |
| `src/mcp/server.ts` | MCP server setup, HTTP listener, start/stop lifecycle |
| `src/mcp/tools.ts` | MCP tool handler implementations (job CRUD, send_message, list_messages) |
| `src/core/scheduler.ts` | Unified scheduler loop (replaces node-cron usage in daemon.ts) |
| `src/db/migrations/006_jobs_scheduling.ts` | Add schedule_type, next_run_at, last_run_at columns |
| `src/db/models/job.ts` | Extended with new fields + computeNextRun |
| `src/channels/telegram.ts` | Export sendToTelegram/setSender for MCP |
| `src/channels/index.ts` | Re-export sendToTelegram |
| `src/chat/engine.ts` | Accept mcpPort, pass to query options |
| `src/chat/identity.ts` | Update system prompt with MCP tool docs |
| `src/core/daemon.ts` | Start MCP server + scheduler, remove node-cron |

---

## Chunk 1: Duration Parser + DB Migration

### Task 1: Duration Parser

**Files:**
- Create: `src/utils/duration.ts`
- Create: `tests/utils/duration.test.ts`

- [ ] **Step 1: Write failing tests for duration parsing**

```typescript
// tests/utils/duration.test.ts
import { describe, expect, test } from "bun:test";
import { parseDuration } from "../../src/utils/duration";

describe("parseDuration", () => {
  test("parses seconds", () => {
    expect(parseDuration("30s")).toBe(30_000);
  });

  test("parses minutes", () => {
    expect(parseDuration("5m")).toBe(300_000);
  });

  test("parses hours", () => {
    expect(parseDuration("2h")).toBe(7_200_000);
  });

  test("parses days", () => {
    expect(parseDuration("1d")).toBe(86_400_000);
  });

  test("throws on invalid format", () => {
    expect(() => parseDuration("abc")).toThrow();
    expect(() => parseDuration("")).toThrow();
    expect(() => parseDuration("5x")).toThrow();
  });

  test("parses compound durations", () => {
    expect(parseDuration("1h30m")).toBe(5_400_000);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/utils/duration.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement duration parser**

```typescript
// src/utils/duration.ts
const UNITS: Record<string, number> = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

export function parseDuration(input: string): number {
  if (!input) throw new Error("Empty duration string");

  const matches = input.matchAll(/(\d+)\s*([smhd])/g);
  let total = 0;
  let matched = false;

  for (const match of matches) {
    const value = parseInt(match[1], 10);
    const unit = match[2];
    total += value * UNITS[unit];
    matched = true;
  }

  if (!matched) throw new Error(`Invalid duration: "${input}"`);
  return total;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/utils/duration.test.ts`
Expected: All 7 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/utils/duration.ts tests/utils/duration.test.ts
git commit -m "feat: add duration string parser (5m, 2h, 1d)"
```

### Task 2: DB Migration — schedule_type, next_run_at, last_run_at

**Files:**
- Create: `src/db/migrations/006_jobs_scheduling.ts`
- Modify: `src/db/models/job.ts`

- [ ] **Step 1: Create migration file**

```typescript
// src/db/migrations/006_jobs_scheduling.ts
import type postgres from "postgres";

export const name = "006_jobs_scheduling";

export async function up(sql: postgres.Sql): Promise<void> {
  await sql`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS schedule_type TEXT DEFAULT 'cron'`;
  await sql`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS next_run_at TIMESTAMPTZ`;
  await sql`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS last_run_at TIMESTAMPTZ`;
}
```

- [ ] **Step 2: Update Job model interface and toJob mapping**

In `src/db/models/job.ts`:

Add to `Job` interface:
```typescript
scheduleType: "cron" | "interval" | "once";
nextRunAt: string | null;
lastRunAt: string | null;
```

Update `toJob()`:
```typescript
scheduleType: r.schedule_type || "cron",
nextRunAt: r.next_run_at ? String(r.next_run_at) : null,
lastRunAt: r.last_run_at ? String(r.last_run_at) : null,
```

Update all SELECT queries to include the new columns.

Update `create()` to accept `scheduleType` and `nextRunAt`:
```typescript
export async function create(
  name: string,
  schedule: string,
  prompt: string,
  always = false,
  scheduleType: "cron" | "interval" | "once" = "cron",
  nextRunAt?: Date,
): Promise<void> {
  const sql = getSql();
  await sql`
    INSERT INTO jobs (name, schedule, prompt, always, schedule_type, next_run_at)
    VALUES (${name}, ${schedule}, ${prompt}, ${always}, ${scheduleType}, ${nextRunAt ?? null})
  `;
  await notifyChange();
}
```

Add `listDue()`:
```typescript
export async function listDue(): Promise<Job[]> {
  const sql = getSql();
  const rows = await sql`
    SELECT name, schedule, prompt, enabled, always, schedule_type, next_run_at, last_run_at, created_at, updated_at
    FROM jobs
    WHERE enabled = TRUE AND next_run_at <= NOW()
    ORDER BY next_run_at
  `;
  return rows.map(toJob);
}
```

Add `markRun()`:
```typescript
export async function markRun(name: string, nextRunAt: Date | null): Promise<void> {
  const sql = getSql();
  if (nextRunAt) {
    await sql`UPDATE jobs SET last_run_at = NOW(), next_run_at = ${nextRunAt}, updated_at = NOW() WHERE name = ${name}`;
  } else {
    await sql`UPDATE jobs SET last_run_at = NOW(), enabled = FALSE, updated_at = NOW() WHERE name = ${name}`;
  }
  await notifyChange();
}
```

- [ ] **Step 3: Run existing tests to verify no regressions**

Run: `bun test`
Expected: All existing tests pass

- [ ] **Step 4: Commit**

```bash
git add src/db/migrations/006_jobs_scheduling.ts src/db/models/job.ts
git commit -m "feat: add schedule_type, next_run_at, last_run_at to jobs table"
```

---

## Chunk 2: Unified Scheduler

### Task 3: Scheduler Module

**Files:**
- Create: `src/core/scheduler.ts`
- Create: `tests/core/scheduler.test.ts`

- [ ] **Step 1: Install cron-parser dependency**

```bash
bun add cron-parser
```

- [ ] **Step 2: Write failing tests for computeNextRun**

```typescript
// tests/core/scheduler.test.ts
import { describe, expect, test } from "bun:test";
import { computeNextRun } from "../../src/core/scheduler";

describe("computeNextRun", () => {
  test("computes next cron run", () => {
    const next = computeNextRun("cron", "0 9 * * *", "UTC");
    expect(next).toBeInstanceOf(Date);
    expect(next!.getUTCHours()).toBe(9);
    expect(next!.getUTCMinutes()).toBe(0);
  });

  test("computes next interval run", () => {
    const now = new Date();
    const next = computeNextRun("interval", "5m", "UTC", now);
    expect(next).toBeInstanceOf(Date);
    expect(next!.getTime()).toBe(now.getTime() + 300_000);
  });

  test("returns null for once (no repeat)", () => {
    const next = computeNextRun("once", "2026-03-13T18:00:00Z", "UTC");
    expect(next).toBeNull();
  });

  test("computes initial next_run_at for cron", () => {
    const next = computeNextRun("cron", "*/5 * * * *", "UTC");
    expect(next).toBeInstanceOf(Date);
    // Should be within next 5 minutes
    expect(next!.getTime() - Date.now()).toBeLessThanOrEqual(5 * 60 * 1000);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `bun test tests/core/scheduler.test.ts`
Expected: FAIL — module not found

- [ ] **Step 4: Implement scheduler module**

```typescript
// src/core/scheduler.ts
import { parseExpression } from "cron-parser";
import { parseDuration } from "../utils/duration";
import { Job } from "../db/models";
import { runJob } from "./runner";
import { getConfig } from "../utils/config";
import { log } from "../utils/log";

export function computeNextRun(
  scheduleType: "cron" | "interval" | "once",
  schedule: string,
  timezone: string,
  lastRunAt?: Date,
): Date | null {
  switch (scheduleType) {
    case "cron": {
      const expr = parseExpression(schedule, { tz: timezone });
      return expr.next().toDate();
    }
    case "interval": {
      const ms = parseDuration(schedule);
      const base = lastRunAt || new Date();
      return new Date(base.getTime() + ms);
    }
    case "once":
      return null; // once-jobs don't repeat
  }
}

export function computeInitialNextRun(
  scheduleType: "cron" | "interval" | "once",
  schedule: string,
  timezone: string,
): Date {
  switch (scheduleType) {
    case "cron": {
      const expr = parseExpression(schedule, { tz: timezone });
      return expr.next().toDate();
    }
    case "interval": {
      const ms = parseDuration(schedule);
      return new Date(Date.now() + ms);
    }
    case "once":
      return new Date(schedule);
  }
}

function isWithinActiveHours(): boolean {
  const config = getConfig();
  const { start, end } = config.activeHours;
  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: config.timezone,
  });
  const current = formatter.format(now).replace(/\u200e/g, "");
  return current >= start && current <= end;
}

let timer: ReturnType<typeof setInterval> | null = null;

async function tick(): Promise<void> {
  let dueJobs: Awaited<ReturnType<typeof Job.listDue>>;
  try {
    dueJobs = await Job.listDue();
  } catch (err) {
    log.warn({ err }, "scheduler: failed to query due jobs");
    return;
  }

  const config = getConfig();

  for (const job of dueJobs) {
    if (!job.always && !isWithinActiveHours()) {
      // Skip but still advance next_run_at so we don't re-trigger every tick
      const nextRun = computeNextRun(
        job.scheduleType,
        job.schedule,
        config.timezone,
        new Date(),
      );
      if (nextRun) {
        await Job.markRun(job.name, nextRun).catch(() => {});
      }
      log.info({ job: job.name }, "scheduler: skipping — outside active hours");
      continue;
    }

    log.info({ job: job.name, type: job.scheduleType }, "scheduler: running job");

    // Fire and forget
    runJob(job).then((result) => {
      log.info({ job: job.name, status: result.status, duration: result.duration_ms }, "scheduler: job completed");
    }).catch((err) => {
      log.error({ err, job: job.name }, "scheduler: job failed");
    });

    // Compute next run
    const nextRun = computeNextRun(
      job.scheduleType,
      job.schedule,
      config.timezone,
      new Date(),
    );
    await Job.markRun(job.name, nextRun).catch((err) => {
      log.error({ err, job: job.name }, "scheduler: failed to update next_run_at");
    });
  }
}

export function startScheduler(): void {
  log.info("scheduler started (60s poll interval)");
  tick(); // run immediately
  timer = setInterval(tick, 60_000);
}

export function stopScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

/** Recompute next_run_at for all enabled jobs (used on startup/reload). */
export async function recomputeAllNextRuns(): Promise<void> {
  const config = getConfig();
  const jobs = await Job.listEnabled();

  for (const job of jobs) {
    if (job.nextRunAt) continue; // already has a next_run_at

    const nextRun = computeInitialNextRun(job.scheduleType, job.schedule, config.timezone);
    const sql = (await import("../db/connection")).getSql();
    await sql`UPDATE jobs SET next_run_at = ${nextRun} WHERE name = ${job.name}`;
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test tests/core/scheduler.test.ts`
Expected: All 4 tests PASS

- [ ] **Step 6: Commit**

```bash
bun add cron-parser
git add src/core/scheduler.ts tests/core/scheduler.test.ts package.json bun.lockb
git commit -m "feat: unified scheduler with cron/interval/once support"
```

---

## Chunk 3: Telegram sendToTelegram Export

### Task 4: Export sendToTelegram from Telegram Channel

**Files:**
- Modify: `src/channels/telegram.ts:1-10,79-84,225-230`
- Modify: `src/channels/index.ts`

- [ ] **Step 1: Add sendToTelegram/setSender exports to telegram.ts**

At the top of `src/channels/telegram.ts` (after imports), add:

```typescript
let telegramSender: ((text: string) => Promise<void>) | null = null;

export function setSender(fn: (text: string) => Promise<void>): void {
  telegramSender = fn;
}

export async function sendToTelegram(text: string): Promise<void> {
  if (!telegramSender) throw new Error("Telegram not configured");
  await telegramSender(text);
}
```

Inside `TelegramChannel.start()`, after `const bot = new Bot(token)` (line ~92), call `setSender`:

```typescript
setSender(async (text: string) => {
  const chatId = outboundChatId;
  if (!chatId) throw new Error("No outbound chat ID registered");
  await bot.api.sendMessage(chatId, text);
});
```

Inside `TelegramChannel.stop()`, clear the sender:

```typescript
async stop(): Promise<void> {
  telegramSender = null; // clear sender
  if (this.bot) {
    this.bot.stop();
    this.bot = null;
  }
}
```

- [ ] **Step 2: Re-export sendToTelegram from channels/index.ts**

Add at the bottom of `src/channels/index.ts`:

```typescript
export { sendToTelegram } from "./telegram";
```

- [ ] **Step 3: Run existing tests**

Run: `bun test`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add src/channels/telegram.ts src/channels/index.ts
git commit -m "feat: export sendToTelegram for MCP server use"
```

---

## Chunk 4: MCP Server

### Task 5: Install MCP SDK

- [ ] **Step 1: Install dependency**

```bash
bun add @modelcontextprotocol/sdk
```

- [ ] **Step 2: Commit**

```bash
git add package.json bun.lockb
git commit -m "chore: add @modelcontextprotocol/sdk dependency"
```

### Task 6: MCP Tool Handlers

**Files:**
- Create: `src/mcp/tools.ts`

- [ ] **Step 1: Implement tool handlers**

```typescript
// src/mcp/tools.ts
import { Job, Message } from "../db/models";
import { computeInitialNextRun } from "../core/scheduler";
import { getConfig } from "../utils/config";
import { sendToTelegram } from "../channels/telegram";
import { Session } from "../db/models";
import { log } from "../utils/log";

export async function listJobs(): Promise<string> {
  const jobs = await Job.list();
  if (jobs.length === 0) return "No jobs found.";
  return JSON.stringify(jobs, null, 2);
}

export async function addJob(args: {
  name: string;
  schedule: string;
  prompt: string;
  schedule_type?: "cron" | "interval" | "once";
  always?: boolean;
}): Promise<string> {
  const scheduleType = args.schedule_type || "cron";
  const always = args.always || false;
  const config = getConfig();

  const nextRunAt = computeInitialNextRun(scheduleType, args.schedule, config.timezone);
  await Job.create(args.name, args.schedule, args.prompt, always, scheduleType, nextRunAt);
  return `Job "${args.name}" created (${scheduleType}: ${args.schedule}). Next run: ${nextRunAt.toISOString()}`;
}

export async function removeJob(name: string): Promise<string> {
  const removed = await Job.remove(name);
  return removed ? `Job "${name}" removed.` : `Job "${name}" not found.`;
}

export async function enableJob(name: string): Promise<string> {
  const updated = await Job.update(name, { enabled: true });
  if (!updated) return `Job "${name}" not found.`;

  // Recompute next_run_at
  const job = await Job.get(name);
  if (job) {
    const config = getConfig();
    const nextRun = computeInitialNextRun(job.scheduleType, job.schedule, config.timezone);
    const { getSql } = await import("../db/connection");
    await getSql()`UPDATE jobs SET next_run_at = ${nextRun} WHERE name = ${name}`;
  }
  return `Job "${name}" enabled.`;
}

export async function disableJob(name: string): Promise<string> {
  const updated = await Job.update(name, { enabled: false });
  return updated ? `Job "${name}" disabled.` : `Job "${name}" not found.`;
}

export async function runJobNow(name: string): Promise<string> {
  const job = await Job.get(name);
  if (!job) return `Job "${name}" not found.`;

  // Set next_run_at to now so scheduler picks it up on next tick
  const { getSql } = await import("../db/connection");
  await getSql()`UPDATE jobs SET next_run_at = NOW() WHERE name = ${name}`;
  return `Job "${name}" queued for immediate execution.`;
}

export async function sendMessage(text: string, channel = "telegram"): Promise<string> {
  if (channel !== "telegram") return `Channel "${channel}" not supported yet.`;

  try {
    await sendToTelegram(text);

    // Store in messages table
    try {
      const config = getConfig();
      const chatId = config.telegram_chat_id;
      if (chatId) {
        const room = `tg-${chatId}`;
        const idx = await Session.getLatestRoomIndex(room);
        const fullRoom = `${room}-${idx}`;
        const sessionId = await Session.getLatest(fullRoom);
        if (sessionId) {
          await Message.save({
            sessionId,
            room: fullRoom,
            sender: "nia",
            content: text,
            isFromAgent: true,
          });
        }
      }
    } catch {
      // DB storage is best-effort
    }

    return "Message sent.";
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `Failed to send: ${msg}`;
  }
}

export async function listMessages(limit = 20, room?: string): Promise<string> {
  const messages = await Message.getRecent(limit, room);
  if (messages.length === 0) return "No messages found.";
  return JSON.stringify(messages, null, 2);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/mcp/tools.ts
git commit -m "feat: MCP tool handler implementations"
```

### Task 7: MCP Server Setup

**Files:**
- Create: `src/mcp/server.ts`

- [ ] **Step 1: Implement MCP server with HTTP transport**

```typescript
// src/mcp/server.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { createServer, type Server } from "http";
import { writeFileSync, unlinkSync } from "fs";
import { getPaths } from "../utils/paths";
import { log } from "../utils/log";
import * as tools from "./tools";

let httpServer: Server | null = null;
let mcpPort: number | null = null;

export function getMcpPort(): number | null {
  return mcpPort;
}

export async function startMcpServer(): Promise<number> {
  const mcp = new McpServer({
    name: "nia",
    version: "0.1.0",
  });

  // Register tools
  mcp.tool("list_jobs", "List all scheduled jobs", {}, async () => ({
    content: [{ type: "text", text: await tools.listJobs() }],
  }));

  mcp.tool(
    "add_job",
    "Create a new scheduled job",
    {
      name: z.string().describe("Unique job name"),
      schedule: z.string().describe("Schedule: cron expression (0 9 * * *), duration (5m, 2h), or ISO timestamp"),
      prompt: z.string().describe("What the job should do"),
      schedule_type: z.enum(["cron", "interval", "once"]).default("cron").describe("Schedule type"),
      always: z.boolean().default(false).describe("If true, runs 24/7 ignoring active hours"),
    },
    async (args) => ({
      content: [{ type: "text", text: await tools.addJob(args) }],
    }),
  );

  mcp.tool(
    "remove_job",
    "Delete a scheduled job",
    { name: z.string().describe("Job name to remove") },
    async (args) => ({
      content: [{ type: "text", text: await tools.removeJob(args.name) }],
    }),
  );

  mcp.tool(
    "enable_job",
    "Enable a disabled job",
    { name: z.string().describe("Job name to enable") },
    async (args) => ({
      content: [{ type: "text", text: await tools.enableJob(args.name) }],
    }),
  );

  mcp.tool(
    "disable_job",
    "Disable a job (stops it from running)",
    { name: z.string().describe("Job name to disable") },
    async (args) => ({
      content: [{ type: "text", text: await tools.disableJob(args.name) }],
    }),
  );

  mcp.tool(
    "run_job",
    "Trigger a job to run immediately",
    { name: z.string().describe("Job name to run now") },
    async (args) => ({
      content: [{ type: "text", text: await tools.runJobNow(args.name) }],
    }),
  );

  mcp.tool(
    "send_message",
    "Send a message to the user via Telegram",
    {
      text: z.string().describe("Message text to send"),
      channel: z.string().default("telegram").describe("Channel to send on (default: telegram)"),
    },
    async (args) => ({
      content: [{ type: "text", text: await tools.sendMessage(args.text, args.channel) }],
    }),
  );

  mcp.tool(
    "list_messages",
    "Read recent chat history",
    {
      limit: z.number().default(20).describe("Number of messages to return"),
      room: z.string().optional().describe("Filter by room name"),
    },
    async (args) => ({
      content: [{ type: "text", text: await tools.listMessages(args.limit, args.room) }],
    }),
  );

  // Start HTTP server
  return new Promise<number>((resolve, reject) => {
    httpServer = createServer(async (req, res) => {
      if (req.method === "POST" && req.url === "/mcp") {
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
        await mcp.connect(transport);
        await transport.handleRequest(req, res);
      } else {
        res.writeHead(404);
        res.end("Not found");
      }
    });

    httpServer.listen(0, "127.0.0.1", () => {
      const addr = httpServer!.address();
      if (typeof addr === "object" && addr) {
        mcpPort = addr.port;
        const portFile = `${getPaths().tmpDir}/mcp-port`;
        writeFileSync(portFile, String(mcpPort));
        log.info({ port: mcpPort }, "MCP server started");
        resolve(mcpPort);
      } else {
        reject(new Error("Failed to get server address"));
      }
    });

    httpServer.on("error", reject);
  });
}

export async function stopMcpServer(): Promise<void> {
  if (httpServer) {
    httpServer.close();
    httpServer = null;
  }
  if (mcpPort) {
    try {
      unlinkSync(`${getPaths().tmpDir}/mcp-port`);
    } catch {}
    mcpPort = null;
  }
}
```

**Note:** The StreamableHTTPServerTransport usage above may need adjustment based on the exact MCP SDK API. The implementer should check `@modelcontextprotocol/sdk` docs and adjust the HTTP handler accordingly. An alternative approach is using `SSEServerTransport` if StreamableHTTP is not available.

- [ ] **Step 2: Run existing tests to verify no regressions**

Run: `bun test`
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add src/mcp/server.ts
git commit -m "feat: MCP server with HTTP transport and 8 tools"
```

---

## Chunk 5: Wire Everything Together

### Task 8: Update Chat Engine to Accept MCP Port

**Files:**
- Modify: `src/chat/engine.ts:139-198`

- [ ] **Step 1: Add mcpPort to EngineOptions**

In `src/chat/engine.ts`, add `mcpPort` to `EngineOptions`:

```typescript
export interface EngineOptions {
  room: string;
  channel: string;
  resume: boolean;
  mcpPort?: number;
}
```

In `createChatEngine()`, read `mcpPort` from opts and pass to query options:

```typescript
const { room, channel, resume, mcpPort } = opts;
```

In `startQuery()`, after building `options` object (line ~188), add:

```typescript
if (mcpPort) {
  (options as any).mcpServers = {
    nia: { url: `http://127.0.0.1:${mcpPort}/mcp` },
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/chat/engine.ts
git commit -m "feat: chat engine accepts mcpPort for MCP server connection"
```

### Task 9: Update Telegram Channel to Pass MCP Port

**Files:**
- Modify: `src/channels/telegram.ts:41-48`

- [ ] **Step 1: Import getMcpPort and pass to createChatEngine**

In `src/channels/telegram.ts`, add import:

```typescript
import { getMcpPort } from "../mcp/server";
```

In `getState()` and `restartChat()`, pass `mcpPort` to `createChatEngine`:

```typescript
const engine = await createChatEngine({ room, channel: "telegram", resume: true, mcpPort: getMcpPort() ?? undefined });
```

Do the same in `restartChat()`.

- [ ] **Step 2: Commit**

```bash
git add src/channels/telegram.ts
git commit -m "feat: telegram channel passes MCP port to chat engine"
```

### Task 10: Update Daemon — Replace node-cron with Scheduler + Start MCP

**Files:**
- Modify: `src/core/daemon.ts`

- [ ] **Step 1: Replace node-cron scheduling with unified scheduler**

Major changes to `src/core/daemon.ts`:

1. Remove `import cron from "node-cron"` and `stopAllCronTasks()`
2. Add imports:
```typescript
import { startScheduler, stopScheduler, recomputeAllNextRuns } from "./scheduler";
import { startMcpServer, stopMcpServer } from "../mcp/server";
```

3. In `runDaemon()`, after startup recovery, before starting channels:
```typescript
// Start MCP server
let mcpStarted = false;
try {
  await startMcpServer();
  mcpStarted = true;
} catch (err) {
  log.error({ err }, "failed to start MCP server");
}
```

4. Replace the entire `scheduleJobs()` function and its call with:
```typescript
// Recompute next_run_at for jobs that don't have one (e.g., legacy cron jobs)
try {
  await recomputeAllNextRuns();
} catch (err) {
  log.warn({ err }, "failed to recompute next_run_at");
}

// Start unified scheduler
startScheduler();
```

5. Keep the pg_notify listener but change the callback:
```typescript
await sql.listen("nia_jobs", async () => {
  log.info("job change detected via NOTIFY, recomputing next runs");
  await recomputeAllNextRuns().catch((err) => {
    log.warn({ err }, "failed to recompute next runs on notify");
  });
});
```

6. Keep SIGHUP handler but update:
```typescript
process.on("SIGHUP", async () => {
  log.info("received SIGHUP, recomputing job schedules");
  await recomputeAllNextRuns().catch(() => {});
});
```

7. In `shutdown()`, add:
```typescript
stopScheduler();
if (mcpStarted) await stopMcpServer();
```

- [ ] **Step 2: Run existing tests**

Run: `bun test`
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add src/core/daemon.ts
git commit -m "feat: replace node-cron with unified scheduler, start MCP server in daemon"
```

### Task 11: Update Terminal REPL to Pass MCP Port

**Files:**
- Modify: `src/chat/repl.ts` (or wherever terminal chat creates engine)

- [ ] **Step 1: Find and update terminal chat engine creation**

The terminal REPL needs to read the MCP port from the port file (`~/.niahere/tmp/mcp-port`) and pass it to `createChatEngine`. If running via `nia run` (daemon mode), the MCP server is in-process so use `getMcpPort()`. If running via `nia chat` (standalone), read the port file.

```typescript
import { getMcpPort } from "../mcp/server";
import { existsSync, readFileSync } from "fs";
import { getPaths } from "../utils/paths";

function discoverMcpPort(): number | undefined {
  // In-process (daemon mode)
  const inProcess = getMcpPort();
  if (inProcess) return inProcess;

  // From port file (standalone chat connecting to running daemon)
  const portFile = `${getPaths().tmpDir}/mcp-port`;
  if (existsSync(portFile)) {
    const port = parseInt(readFileSync(portFile, "utf8").trim(), 10);
    if (!isNaN(port)) return port;
  }

  return undefined;
}
```

Pass `mcpPort: discoverMcpPort()` to `createChatEngine()`.

- [ ] **Step 2: Commit**

```bash
git add src/chat/repl.ts
git commit -m "feat: terminal REPL discovers and uses MCP port"
```

### Task 12: Update System Prompt

**Files:**
- Modify: `src/chat/identity.ts:89-110`

- [ ] **Step 1: Replace CLI job docs with MCP tool docs**

In `src/chat/identity.ts`, replace the `## Managing Jobs` section in `buildEnvironmentContext()` with:

```typescript
`## Managing Jobs

You have MCP tools for managing jobs directly — no need for shell commands:

- **list_jobs** — see all scheduled jobs with status and next run time
- **add_job** — create a new job. Supports three schedule types:
  - \`cron\`: standard cron expression (e.g., "0 9 * * *" = daily at 9am)
  - \`interval\`: duration string (e.g., "5m", "2h", "1d" = every 5 min/2 hours/1 day)
  - \`once\`: ISO timestamp for one-time execution (e.g., "2026-03-14T10:00:00")
  - Set \`always: true\` to run 24/7 (ignores active hours)
- **remove_job** — delete a job by name
- **enable_job** / **disable_job** — toggle a job on or off
- **run_job** — trigger a job to run immediately
- **send_message** — send a message to the user via Telegram
- **list_messages** — read recent chat history

Active hours: ${config.activeHours.start}–${config.activeHours.end} (${config.timezone}). Jobs respect this; crons (always=true) don't.`
```

- [ ] **Step 2: Run identity tests**

Run: `bun test tests/chat/identity.test.ts`
Expected: Update tests that check for "nia job" or "--always" CLI docs. These should now check for MCP tool names instead.

- [ ] **Step 3: Update identity tests**

In `tests/chat/identity.test.ts`, update:
```typescript
test("includes job management tools", () => {
  const prompt = buildSystemPrompt();
  expect(prompt).toContain("list_jobs");
  expect(prompt).toContain("add_job");
  expect(prompt).toContain("send_message");
});
```

- [ ] **Step 4: Run all tests**

Run: `bun test`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add src/chat/identity.ts tests/chat/identity.test.ts
git commit -m "feat: update system prompt with MCP tool docs instead of CLI commands"
```

---

## Chunk 6: CLI Updates + Final Integration

### Task 13: Update CLI Job Add for Schedule Types

**Files:**
- Modify: `src/cli/job.ts`

- [ ] **Step 1: Update `nia job add` to accept --type flag**

In the `add` subcommand handler in `src/cli/job.ts`, add `--type` flag parsing:

```typescript
// Parse --type flag (cron, interval, once)
const typeIdx = args.indexOf("--type");
let scheduleType: "cron" | "interval" | "once" = "cron";
if (typeIdx !== -1 && args[typeIdx + 1]) {
  const val = args[typeIdx + 1];
  if (val === "cron" || val === "interval" || val === "once") {
    scheduleType = val;
    args.splice(typeIdx, 2);
  }
}
```

Pass `scheduleType` and computed `nextRunAt` to `Job.create()`:

```typescript
import { computeInitialNextRun } from "../core/scheduler";
import { getConfig } from "../utils/config";

const config = getConfig();
const nextRunAt = computeInitialNextRun(scheduleType, schedule, config.timezone);
await Job.create(name, schedule, prompt, always, scheduleType, nextRunAt);
```

Update the list display to show schedule_type:

```typescript
const tag = j.always ? " [always]" : "";
const type = j.scheduleType !== "cron" ? ` (${j.scheduleType})` : "";
console.log(`  ${icon} ${j.name}  ${j.schedule}${type}${tag}`);
```

- [ ] **Step 2: Run all tests**

Run: `bun test`
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add src/cli/job.ts
git commit -m "feat: nia job add supports --type cron/interval/once"
```

### Task 14: Remove node-cron Dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Check if node-cron is still used anywhere**

Search for `node-cron` imports. After the daemon.ts changes, it should only be in legacy cron.ts (YAML fallback). If cron.ts is still needed as fallback, keep node-cron. If not, remove it:

```bash
bun remove node-cron
bun remove @types/node-cron
```

- [ ] **Step 2: Commit**

```bash
git add package.json bun.lockb
git commit -m "chore: remove node-cron dependency (replaced by cron-parser)"
```

### Task 15: Smoke Test

- [ ] **Step 1: Start daemon and verify MCP server starts**

```bash
bun run dev
# Check logs for "MCP server started" with port number
```

- [ ] **Step 2: Test via terminal chat**

```bash
nia chat
# Type: "list all my jobs"
# Agent should use list_jobs MCP tool instead of running nia job list
```

- [ ] **Step 3: Test job creation via chat**

```
> add a job called test-mcp that runs every 5 minutes and says hello
# Agent should use add_job MCP tool with schedule_type=interval, schedule=5m
```

- [ ] **Step 4: Test send_message**

```
> send me a telegram message saying "MCP works!"
# Agent should use send_message MCP tool
```

- [ ] **Step 5: Bump version and commit**

```bash
# Update package.json version to 0.2.0
git add -A
git commit -m "feat: MCP server with job management, messaging, and enhanced scheduling"
```
