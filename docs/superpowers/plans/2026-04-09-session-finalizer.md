# Session Finalizer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace ad-hoc consolidation/summarization calls with a unified, DB-backed finalizer that gives instant exit to short-lived processes (REPL, `nia job run`, `nia run`) while the daemon reliably processes the work.

**Architecture:** A `finalization_requests` table acts as a durable queue. All callers write a row and return immediately. In daemon mode, the finalizer also processes inline (fire-and-forget). In CLI mode, it fires `pg_notify('nia_finalize')` to wake the daemon. The daemon listens on `nia_finalize`, drains pending requests, and also drains on startup. Session activity cancels pending (not yet processing) requests.

**Tech Stack:** PostgreSQL (postgres npm package), Bun.js, existing `runTask()` from `src/core/runner.ts`

---

## File Structure

| File                                             | Action | Responsibility                                                                                                    |
| ------------------------------------------------ | ------ | ----------------------------------------------------------------------------------------------------------------- |
| `src/db/migrations/014_finalization_requests.ts` | Create | Migration for `finalization_requests` table                                                                       |
| `src/core/finalizer.ts`                          | Create | Unified finalizer: `finalizeSession()`, `cancelPending()`, `processPending()`, `startFinalizer()`, role detection |
| `src/chat/engine.ts`                             | Modify | Replace direct consolidator/summarizer calls with `finalizeSession()` and `cancelPending()`                       |
| `src/chat/repl.ts`                               | Modify | Remove `await` on close, revert close() to sync-safe usage                                                        |
| `src/cli/index.ts`                               | Modify | `nia run` path: call `finalizeSession()` instead of `engine.close()` fire-and-forget                              |
| `src/core/daemon.ts`                             | Modify | Add `nia_finalize` listener, drain on startup, set process role                                                   |
| `src/types/engine.ts`                            | Modify | Revert `close()` back to `void` (no longer needs to be async)                                                     |
| `tests/core/finalizer.test.ts`                   | Create | Unit tests for finalizer logic                                                                                    |

Note: `consolidateJobRun` in `src/core/runner.ts` stays as-is (fire-and-forget). Job consolidation can't be delegated because the full job result isn't persisted — only the audit truncates to 2k chars. This is a future improvement.

---

### Task 1: Migration — `finalization_requests` table

**Files:**

- Create: `src/db/migrations/014_finalization_requests.ts`

- [ ] **Step 1: Write the migration**

```typescript
import type postgres from "postgres";

export const name = "014_finalization_requests";

export async function up(sql: postgres.Sql): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS finalization_requests (
      id            SERIAL PRIMARY KEY,
      session_id    TEXT NOT NULL,
      room          TEXT NOT NULL,
      message_count INT NOT NULL,
      status        TEXT NOT NULL DEFAULT 'pending',
      created_at    TIMESTAMPTZ DEFAULT NOW(),
      updated_at    TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_finalization_session
    ON finalization_requests (session_id, status)
  `;
}
```

`status` values: `pending`, `processing`, `done`, `failed`.
`message_count` is the idempotency key — a completed finalization for session X with 6 messages doesn't block a future one with 10 messages.

- [ ] **Step 2: Verify migration loads**

Run: `npm run typecheck`
Expected: PASS — migration follows the existing pattern (see `003_active_engines.ts`)

- [ ] **Step 3: Commit**

```bash
git add src/db/migrations/014_finalization_requests.ts
git commit -m "feat: add finalization_requests migration"
```

---

### Task 2: Core finalizer module

**Files:**

- Create: `src/core/finalizer.ts`
- Create: `tests/core/finalizer.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, expect, test, beforeEach, afterEach, mock } from "bun:test";
import { resetConfig, setTestConfig } from "../utils/test-helpers";

// We'll test the pure logic functions — enqueue, cancel, process
// DB interactions are tested via the model functions

describe("finalizer", () => {
  describe("role detection", () => {
    test("defaults to cli role", async () => {
      const { getRole } = await import("../../src/core/finalizer");
      expect(getRole()).toBe("cli");
    });

    test("setRole changes role", async () => {
      const { getRole, setRole } = await import("../../src/core/finalizer");
      setRole("daemon");
      expect(getRole()).toBe("daemon");
      setRole("cli"); // reset
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/core/finalizer.test.ts`
Expected: FAIL — module doesn't exist

- [ ] **Step 3: Write the finalizer module**

```typescript
/**
 * Unified session finalizer — durable queue for post-session work.
 *
 * All callers use finalizeSession() instead of calling consolidator/summarizer
 * directly. The function writes a row to finalization_requests and returns
 * immediately. In daemon mode, it also starts processing inline. In CLI mode,
 * it fires pg_notify('nia_finalize') to wake the daemon.
 *
 * The daemon listens on nia_finalize and also drains pending requests on startup.
 */

import { getSql } from "../db/connection";
import { consolidateSession } from "./consolidator";
import { summarizeSession } from "./summarizer";
import { log } from "../utils/log";

type ProcessRole = "daemon" | "cli";
let role: ProcessRole = "cli";

export function setRole(r: ProcessRole): void {
  role = r;
}

export function getRole(): ProcessRole {
  return role;
}

/** Enqueue a session for finalization. Returns immediately for CLI callers. */
export async function finalizeSession(sessionId: string, room: string): Promise<void> {
  const sql = getSql();

  // Get current message count for idempotency
  const countRows = await sql`
    SELECT COUNT(*)::int AS count FROM messages WHERE session_id = ${sessionId}
  `;
  const messageCount = countRows[0]?.count ?? 0;
  if (messageCount < 2) return;

  // Cancel any pending request for this session (session resumed or new close)
  await sql`
    DELETE FROM finalization_requests
    WHERE session_id = ${sessionId} AND status = 'pending'
  `;

  // Skip if already done/processing for this exact message count
  const existing = await sql`
    SELECT id FROM finalization_requests
    WHERE session_id = ${sessionId}
      AND message_count = ${messageCount}
      AND status IN ('done', 'processing')
    LIMIT 1
  `;
  if (existing.length > 0) return;

  // Insert new request
  await sql`
    INSERT INTO finalization_requests (session_id, room, message_count, status)
    VALUES (${sessionId}, ${room}, ${messageCount}, 'pending')
  `;

  if (role === "daemon") {
    // Process inline (fire-and-forget) — we're long-lived
    processOne(sessionId, room, messageCount).catch((err) => {
      log.error({ err, sessionId, room }, "finalizer: inline processing failed");
    });
  } else {
    // Wake the daemon via NOTIFY
    await sql.notify("nia_finalize", sessionId).catch((err) => {
      log.warn({ err, sessionId }, "finalizer: pg_notify failed (daemon may not be running)");
    });
  }
}

/** Cancel pending finalization for a session (e.g. session resumed). */
export async function cancelPending(sessionId: string): Promise<void> {
  const sql = getSql();
  await sql`
    DELETE FROM finalization_requests
    WHERE session_id = ${sessionId} AND status = 'pending'
  `;
}

/** Process a single finalization request. */
async function processOne(sessionId: string, room: string, messageCount: number): Promise<void> {
  const sql = getSql();

  // Claim the request (pending -> processing)
  const claimed = await sql`
    UPDATE finalization_requests
    SET status = 'processing', updated_at = NOW()
    WHERE session_id = ${sessionId}
      AND message_count = ${messageCount}
      AND status = 'pending'
    RETURNING id
  `;
  if (claimed.length === 0) return; // Already claimed or cancelled

  const requestId = claimed[0].id;

  try {
    await Promise.allSettled([consolidateSession(sessionId, room), summarizeSession(sessionId, room)]);

    await sql`
      UPDATE finalization_requests
      SET status = 'done', updated_at = NOW()
      WHERE id = ${requestId}
    `;

    log.info({ sessionId, room, messageCount }, "finalizer: completed");
  } catch (err) {
    await sql`
      UPDATE finalization_requests
      SET status = 'failed', updated_at = NOW()
      WHERE id = ${requestId}
    `.catch(() => {});

    log.error({ err, sessionId, room }, "finalizer: processing failed");
  }
}

/** Drain all pending finalization requests. Called by daemon on startup and on NOTIFY. */
export async function processPending(): Promise<void> {
  const sql = getSql();

  const pending = await sql`
    SELECT session_id, room, message_count
    FROM finalization_requests
    WHERE status = 'pending'
    ORDER BY created_at ASC
  `;

  for (const row of pending) {
    await processOne(row.session_id, row.room, row.message_count);
  }
}

/** Clean up old completed/failed requests (> 7 days). Called periodically by daemon. */
export async function cleanupOldRequests(): Promise<void> {
  const sql = getSql();
  await sql`
    DELETE FROM finalization_requests
    WHERE status IN ('done', 'failed')
      AND updated_at < NOW() - INTERVAL '7 days'
  `;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/core/finalizer.test.ts`
Expected: PASS

- [ ] **Step 5: Run full typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/core/finalizer.ts tests/core/finalizer.test.ts
git commit -m "feat: add unified session finalizer with DB-backed queue"
```

---

### Task 3: Wire daemon — role, listener, startup drain

**Files:**

- Modify: `src/core/daemon.ts:146` (runDaemon function)

- [ ] **Step 1: Add finalizer imports and set daemon role**

At the top of `runDaemon()` (after the env var cleanup on line 151), add:

```typescript
import { setRole, processPending, cleanupOldRequests } from "./finalizer";
```

At the top of `runDaemon()` body, after the env var deletes (line 151):

```typescript
setRole("daemon");
```

- [ ] **Step 2: Add nia_finalize listener after the nia_jobs listener**

After the `nia_jobs` listener block (after line 261), add:

```typescript
// Listen for session finalization requests from CLI processes
try {
  await sql.listen("nia_finalize", async () => {
    log.info("finalization request received via NOTIFY, processing pending");
    await processPending().catch((err) => {
      log.warn({ err }, "failed to process pending finalizations on notify");
    });
  });
  log.info("listening for finalization requests on nia_finalize channel");
} catch (err) {
  log.warn({ err }, "could not subscribe to nia_finalize");
}
```

Note: `sql` is already in scope from the `nia_jobs` block (line 251).

- [ ] **Step 3: Drain pending requests on startup**

After the `nia_finalize` listener, add:

```typescript
// Drain any finalization requests that arrived while daemon was down
processPending().catch((err) => {
  log.warn({ err }, "startup: failed to drain pending finalizations");
});
```

- [ ] **Step 4: Add periodic cleanup**

In the scheduler section (near line 244), or just after the startup drain, add a simple interval:

```typescript
// Clean up old finalization requests every 24h
setInterval(
  () => {
    cleanupOldRequests().catch((err) => {
      log.warn({ err }, "failed to cleanup old finalization requests");
    });
  },
  24 * 60 * 60 * 1000,
);
```

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/core/daemon.ts
git commit -m "feat: daemon listens on nia_finalize, drains on startup"
```

---

### Task 4: Replace engine.ts call sites

**Files:**

- Modify: `src/chat/engine.ts:21-22` (imports)
- Modify: `src/chat/engine.ts:176-184` (idle timer)
- Modify: `src/chat/engine.ts:526-533` (close method)
- Modify: `src/types/engine.ts:21` (ChatEngine interface)

- [ ] **Step 1: Update imports in engine.ts**

Replace:

```typescript
import { consolidateSession } from "../core/consolidator";
import { summarizeSession } from "../core/summarizer";
```

With:

```typescript
import { finalizeSession, cancelPending } from "../core/finalizer";
```

- [ ] **Step 2: Update idle timer (line 176-184)**

Replace:

```typescript
// Memory consolidation + session summary before "sleep"
if (sessionId && messageCount > 0) {
  consolidateSession(sessionId, room).catch((err) => {
    log.error({ err, room }, "consolidation failed during idle teardown");
  });
  summarizeSession(sessionId, room).catch((err) => {
    log.error({ err, room }, "session summary failed during idle teardown");
  });
}
```

With:

```typescript
// Enqueue finalization before "sleep"
if (sessionId && messageCount > 0) {
  finalizeSession(sessionId, room).catch((err) => {
    log.error({ err, room }, "finalization enqueue failed during idle teardown");
  });
}
```

- [ ] **Step 3: Update close() method (line 526-533)**

Replace:

```typescript
async close() {
  // Memory consolidation + session summary on explicit close
  if (sessionId && messageCount > 0 && !pending) {
    await Promise.allSettled([consolidateSession(sessionId, room), summarizeSession(sessionId, room)]);
  }
  teardown();
  await ActiveEngine.unregister(room).catch(() => {});
},
```

With:

```typescript
close() {
  // Enqueue finalization — processed by daemon or inline if we are the daemon
  if (sessionId && messageCount > 0 && !pending) {
    finalizeSession(sessionId, room).catch((err) => {
      log.error({ err, room }, "finalization enqueue failed during close");
    });
  }
  teardown();
  ActiveEngine.unregister(room).catch(() => {});
},
```

`close()` is now sync-safe again — it fires and forgets. The finalizer handles durable delivery.

- [ ] **Step 4: Add cancelPending on session resume**

In the `send()` method (around line 479), after the idle timer is cleared (`clearIdleTimer()`), add:

```typescript
// Cancel any pending finalization — session is active again
if (sessionId) {
  cancelPending(sessionId).catch(() => {});
}
```

- [ ] **Step 5: Update ChatEngine interface**

In `src/types/engine.ts`, line 21, revert to:

```typescript
close(): void;
```

(It's already `void` in the original — if it was changed to `Promise<void>` during the earlier fix attempt, revert it.)

- [ ] **Step 6: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/chat/engine.ts src/types/engine.ts
git commit -m "refactor: engine uses finalizer instead of direct consolidator/summarizer"
```

---

### Task 5: Fix repl.ts and nia run exit paths

**Files:**

- Modify: `src/chat/repl.ts:225-229` (close handler)
- Modify: `src/cli/index.ts:241` (nia run path)

- [ ] **Step 1: Simplify repl.ts close handler**

Replace lines 225-229:

```typescript
rl.on("close", async () => {
  console.log(`\n${DIM}bye${RESET}`);
  engine.close();
  await closeDb();
  process.exit(0);
});
```

With:

```typescript
rl.on("close", () => {
  console.log(`\n${DIM}bye${RESET}`);
  engine.close();
  closeDb()
    .catch(() => {})
    .finally(() => process.exit(0));
});
```

`engine.close()` now just enqueues a finalization row + fires NOTIFY. The DB write completes in milliseconds. `closeDb()` is safe to call after — the finalization row is already persisted. Exit is effectively instant.

- [ ] **Step 2: Fix nia run path in index.ts**

At line 241, `engine.close()` is already fire-and-forget (it's inside `withDb` which closes DB after). Since `close()` is now sync-safe and just writes a row, this works correctly. No change needed — verify by reading the code.

If `engine.close()` was changed to `await engine.close()` in the earlier fix, revert to just `engine.close()`.

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/chat/repl.ts src/cli/index.ts
git commit -m "fix: instant REPL exit — finalizer handles background work"
```

---

### Task 6: Full test pass and cleanup

**Files:**

- All modified files

- [ ] **Step 1: Run full test suite**

Run: `npm run test`
Expected: All tests pass (typecheck + 210+ tests)

- [ ] **Step 2: Verify no stale consolidator/summarizer imports**

Search for any remaining direct imports of consolidator/summarizer outside of `finalizer.ts` and `runner.ts` (runner.ts keeps `consolidateJobRun` for now):

```bash
rg "from.*consolidator|from.*summarizer" src/ --glob '!src/core/finalizer.ts' --glob '!src/core/runner.ts'
```

Expected: No results. If any remain, update them to use `finalizeSession` from the finalizer.

- [ ] **Step 3: Verify NOTIFY usage**

```bash
rg "nia_finalize" src/
```

Expected: Hits in `src/core/finalizer.ts` (notify) and `src/core/daemon.ts` (listen).

- [ ] **Step 4: Update CHANGELOG.md**

Add to `[Unreleased]`:

```markdown
### Improved

- **Unified session finalizer** — consolidated ad-hoc consolidation/summarization calls into a single DB-backed finalizer queue (`finalization_requests` table). REPL and CLI exits are now instant — the daemon processes post-session work reliably via `pg_notify`. Fixes `CONNECTION_ENDED` errors on `nia chat` exit.
```

- [ ] **Step 5: Update AGENTS.md**

In the Key Patterns section, add:

```markdown
- **Session finalization:** Post-session consolidation and summarization are managed by a unified finalizer (`src/core/finalizer.ts`). All callers use `finalizeSession(sessionId, room)` which writes to a `finalization_requests` table and returns instantly. The daemon listens on `nia_finalize` and drains pending requests on startup. In-memory dedupe in consolidator/summarizer still works within a process; cross-process idempotency is handled by `message_count` in the queue.
```

- [ ] **Step 6: Final commit**

```bash
git add CHANGELOG.md AGENTS.md
git commit -m "docs: add finalizer to changelog and agents.md"
```

---

## Summary of behavioral changes

| Caller                | Before                                                                           | After                                                          |
| --------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `nia chat` exit       | `await` consolidation → `closeDb()` → `process.exit()` (slow + CONNECTION_ENDED) | Write row → NOTIFY → `closeDb()` → `process.exit(0)` (instant) |
| `nia run <prompt>`    | `engine.close()` fire-and-forget → `process.exit()` (lost)                       | Write row → NOTIFY → exit (daemon picks it up)                 |
| `nia job run`         | `process.exit()` kills background consolidation (lost)                           | Job consolidation unchanged (fire-and-forget via runner.ts)    |
| Daemon idle timer     | Direct fire-and-forget consolidator/summarizer calls                             | `finalizeSession()` → processes inline immediately             |
| Daemon explicit close | Direct fire-and-forget calls                                                     | `finalizeSession()` → processes inline immediately             |
| Session resumes       | Nothing                                                                          | `cancelPending()` deletes any pending request                  |
| Daemon startup        | Nothing                                                                          | Drains any pending requests from while it was down             |
