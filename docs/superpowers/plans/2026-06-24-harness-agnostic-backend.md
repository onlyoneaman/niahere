# Harness-Agnostic Nia — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One `AgentBackend` seam with three backends — Claude (in-process SDK, primary), Codex and Gemini (spawned CLIs reaching one shared tool table over MCP) — plus automatic Claude→fallback failover.

**Architecture:** The orchestrator (`engine.ts`/`runner.ts`) consumes only a normalized `AgentEvent` stream and never branches on backend. Each backend is a closed adapter. Nia's 21 tools become one `NIA_TOOLS` table served two ways: in-process to Claude (today's path), and over a loopback HTTP MCP endpoint to the CLI backends (per-run frozen context). Spec: `docs/superpowers/specs/2026-06-24-harness-agnostic-backend-design.md`.

**Tech Stack:** TypeScript, Bun (`bun:test`), `@anthropic-ai/claude-agent-sdk`, `@modelcontextprotocol/sdk` (already a dep), `codex` + `gemini` CLIs.

## Global Constraints

- **Zero behavior change through Phase 1.** Claude chat + jobs behave identically; existing suites (`tests/chat/engine.test.ts`, `tests/chat/engine.integration.test.ts`, `tests/core/runner.test.ts`) stay green.
- **DRY:** exactly one tool table (`NIA_TOOLS`); both transports consume it. One shared subprocess-spawn/env-scrub helper for Codex+Gemini. One JSONL-line reader shared by the CLI adapters.
- **SOLID:** the orchestrator depends on the `AgentBackend`/`AgentSession` abstractions only. Adding a backend = adding one adapter file under `src/agent/backends/`, with no edit to consumers. No `if (backend === …)` outside `src/agent/registry.ts`.
- **No patchwork:** raw CLI/SDK output is normalized to `AgentEvent` inside the adapter; backend session ids are opaque; resume is a per-backend `canResume()` boolean. No copy-pasted env-scrub or output-parsing.
- **No backwards-compat shims** (project rule): remove `config.runner` and the `runJobWithCodex` dead path by hand; no fallback aliases. `config.runner` survives (read-but-ignored) through Phases 1–2 and is removed wholesale in Phase 3 when the `backends` selector replaces it — its five sites: `runner.ts:362`, `types/config.ts:104`, `config.ts` defaults (`13,99,252`), `commands/validate.ts:80-85`.
- **Test command:** `LOG_LEVEL=silent bun test <path>` for a file; `bun run test` for the full gate (`tsc --noEmit && check:cycles && bun test`). Run the full gate before each phase's final commit.

---

## Phase 1 — The seam + one tool table + Claude extraction (behavior-preserving)

Delivers the `AgentBackend` abstraction and routes Claude through it, with the tool table extracted DRY. No new capability, zero behavior change — this de-risks the core rewrite before any CLI backend exists.

### Phase 1 corrections (from plan review — MUST apply; these cross-cut the tasks)

Behavior-preservation is only real if these are honored — they are where the engine's entangled state crosses the new seam:

1. **Characterization tests FIRST (new Task 1.0).** Before any extraction, write three tests against the _current_ `engine.ts` that pin the hard behaviors, so "stay green" is a real gate: (a) a brand-new session saves the user message **once** at init and increments `messageCount` once; (b) a transient-error retry does **not** double-save the user message or double-count; (c) the resumed-session id used by finalize matches the post-init id. Run them green against today's code, then keep them green through 1.5.
2. **One `session` event per `send()`, across internal retries (Blocker 1).** `ClaudeSession.send()` must emit at most one `session` event even when it internally tears down and restarts the query on a retryable error (it swallows the post-retry SDK `init`). The engine then saves the user message idempotently on the first `session` event. This is what prevents the retry double-save (`engine.ts:382–392,526–551`).
3. **`backendSessionId` re-read contract (Blocker 2).** The engine reads `session.backendSessionId` **after** each `send()` drains, and threads that value into finalizer/`cancelPending`/close (`engine.ts:277,619,662`). Never cache the id from before the send.
4. **`AgentSession.abort(reason)` (Blocker 3).** The engine registers `registerActiveHandle(room, () => session.abort(reason))` instead of the old closure. `ClaudeSession` makes retry teardown+restart atomic w.r.t. abort. (Interface already updated in the spec.)
5. **Enumerate all three `runJobWithClaude` consumers (Blocker 4).** `src/core/alive.ts:127` (recovery agent) and `runTask` (`runner.ts:294`, consolidator/summarizer) both call `runJobWithClaude` directly, plus `runJob`. Task 1.5 **keeps `runJobWithClaude`'s exact exported signature** (re-implemented over `ClaudeBackend`) so all three keep compiling. Do NOT collapse it away in Phase 1. `runTask` stays Claude-only in Phase 1 (failover is Phase 3).
6. **Reconcile the two MCP-wiring paths (Major 5).** Chat passes a pre-built `mcpServers` blob down via `EngineOptions.mcpServers` (built by the channel through `getMcpServers(slackCtx)`, `slack.ts:109`); jobs pass a raw `McpSourceContext`. So `AgentSessionContext` carries an optional pre-built `mcpServers?` (chat path) AND `source?: McpSourceContext` (job path); `ClaudeBackend` uses whichever is present and never calls `getMcpServers` itself (or chat loses Slack thread ctx). Settle this in 1.2's interface before 1.5.
7. **`retryable` ≠ `providerDown` (Major 6).** In `SdkNormalizer`, set them from **different** predicates: `retryable = isRetryableApiError(raw)` (transient 5xx/overloaded → in-backend retry), `providerDown = getChatErrorSignal(raw) === "provider_down"` (blank/"unknown error" → failover). A transient 529 is `{retryable:true, providerDown:false}`; a blank error is `{retryable:false, providerDown:true}`. Test both axes on distinct inputs.
8. **Normalizers share an interface (DRY/SOLID).** Declare `interface Normalizer { consume(msg: unknown): AgentEvent[] }` in `src/agent/types.ts`; `SdkNormalizer` (and later `CodexNormalizer`/`GeminiNormalizer`) implement it. Keep normalizers **pure** (no I/O, no timers) so `ClaudeSession` stays just orchestration.
9. **Drop the `buildContentBlocks` re-export (Minor 9).** Move it to `message-stream.ts` and update `tests/chat/engine.test.ts` to import from the new home — no re-export shim (project rule: no backwards-compat).
10. **`handler` arg type:** prefer `unknown` over `any` in `NiaTool` where cheap; it's a serialization boundary.

### Task 1.1: `NIA_TOOLS` — one tool table (DRY)

**Files:**

- Create: `src/mcp/tools/table.ts`
- Modify: `src/mcp/server.ts` (consume the table)
- Test: `tests/mcp/table.test.ts`

**Interfaces:**

- Consumes: `* as handlers` from `./` (`src/mcp/tools/index.ts`), `McpSourceContext` from `../index`, `zod`.
- Produces: `interface NiaTool { name: string; description: string; schema: z.ZodRawShape; handler: (args: any, ctx?: McpSourceContext) => Promise<string> | string }` and `export const NIA_TOOLS: NiaTool[]`. Later tasks (the in-process server and the loopback endpoint) both map over `NIA_TOOLS`.

- [ ] **Step 1: Write the failing test**

`tests/mcp/table.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { NIA_TOOLS } from "../../src/mcp/tools/table";

describe("NIA_TOOLS", () => {
  test("contains all 21 tools with unique names", () => {
    const names = NIA_TOOLS.map((t) => t.name);
    expect(names.length).toBe(21);
    expect(new Set(names).size).toBe(21);
    expect(names).toContain("send_message");
    expect(names).toContain("place_call");
    expect(names).toContain("add_job");
  });

  test("every tool has a description and a callable handler", () => {
    for (const t of NIA_TOOLS) {
      expect(t.description.length).toBeGreaterThan(0);
      expect(typeof t.handler).toBe("function");
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `LOG_LEVEL=silent bun test tests/mcp/table.test.ts`
Expected: FAIL — cannot resolve `table`.

- [ ] **Step 3: Create `src/mcp/tools/table.ts`** — port every tool from `src/mcp/server.ts:11–374` into table entries. Each entry is `{ name, description, schema, handler }` where `schema` is the zod-shape object and `handler` returns the text string (the inner `await handlers.X(...)`). `send_message` is the only handler taking `ctx`:

```ts
import { z } from "zod";
import * as handlers from "./index";
import type { McpSourceContext } from "../index";

export interface NiaTool {
  name: string;
  description: string;
  schema: z.ZodRawShape;
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
  // ... port the remaining 19 tools verbatim (update_job, remove_job, enable_job, disable_job,
  // archive_job, unarchive_job, run_job, send_message, list_messages, list_sessions,
  // search_messages, read_session, add_watch_channel, remove_watch_channel, enable_watch_channel,
  // disable_watch_channel, add_rule, read_memory, add_memory, list_agents, list_employees, place_call) ...
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
];
```

(Port the full list — the entries above are the shape; copy each description/schema verbatim from `server.ts` so nothing drifts.)

- [ ] **Step 4: Rewrite `src/mcp/server.ts` to map over `NIA_TOOLS`**

```ts
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { NIA_TOOLS } from "./tools/table";
import type { McpSourceContext } from "./index";

export function createNiaMcpServer(sourceCtx?: McpSourceContext) {
  return createSdkMcpServer({
    name: "nia",
    version: "0.1.0",
    tools: NIA_TOOLS.map((t) =>
      tool(t.name, t.description, t.schema, async (args: unknown) => ({
        content: [{ type: "text" as const, text: await t.handler(args, sourceCtx) }],
      })),
    ),
  });
}
```

- [ ] **Step 5: Run table test + the existing MCP/engine suites**

Run: `LOG_LEVEL=silent bun test tests/mcp/table.test.ts tests/chat/engine.test.ts`
Expected: PASS. The in-process server is behavior-identical (same names/schemas/handlers).

- [ ] **Step 6: Commit**

```bash
git add src/mcp/tools/table.ts src/mcp/server.ts tests/mcp/table.test.ts
git commit -m "refactor(mcp): extract NIA_TOOLS table; server maps over it (DRY)"
```

### Task 1.2: `AgentEvent` + `AgentBackend`/`AgentSession` interfaces

**Files:**

- Create: `src/agent/types.ts`
- Test: `tests/agent/types.test.ts`

**Interfaces:**

- Consumes: `Attachment` from `../types/attachment`, `McpSourceContext` from `../mcp`.
- Produces: `AgentEvent`, `AgentUsage`, `AgentSession`, `AgentBackend`, `AgentSessionContext`, `AgentDef`, and a type guard `isResultEvent`. Every later task imports these names.

- [ ] **Step 1: Write the failing test** — assert the discriminated union narrows and the guard works (mirror the spec's `AgentEvent`):

```ts
import { describe, expect, test } from "bun:test";
import { isResultEvent, type AgentEvent } from "../../src/agent/types";

test("isResultEvent narrows result events", () => {
  const ev: AgentEvent = { type: "result", text: "ok", usage: { costUsd: 0.01 }, backendSessionId: "s1" };
  expect(isResultEvent(ev)).toBe(true);
  const t: AgentEvent = { type: "text", delta: "hi" };
  expect(isResultEvent(t)).toBe(false);
});
```

- [ ] **Step 2: Run → FAIL** (`bun test tests/agent/types.test.ts`, cannot resolve).

- [ ] **Step 3: Create `src/agent/types.ts`** — exactly the interfaces from the spec's "The seam" section, plus:

```ts
export function isResultEvent(ev: AgentEvent): ev is Extract<AgentEvent, { type: "result" }> {
  return ev.type === "result";
}
```

- [ ] **Step 4: Run → PASS.**

- [ ] **Step 5: Commit** `feat(agent): add AgentEvent vocabulary and AgentBackend interfaces`.

### Task 1.3: `SdkNormalizer` — Claude SDK message → AgentEvent (pure)

Extracts the SDK-event handling duplicated in `engine.ts:372–573` and `runner.ts:170–243` into one tested pure reducer.

**Files:**

- Create: `src/agent/backends/claude-normalize.ts`
- Test: `tests/agent/claude-normalize.test.ts`

**Interfaces:**

- Consumes: `AgentEvent` (1.2), `truncate`/`formatToolUse` from `../../utils/format-activity`, `isRetryableApiError` from `../../utils/retry`.
- Produces: `class SdkNormalizer { consume(message: unknown): AgentEvent[] }` holding text/thinking accumulation.

- [ ] **Step 1: Write the failing test** — cover: `system/init`→`session`; `text_delta`→`text`; `thinking_delta` newline-boundary→`thinking`; `tool_use_summary`→`tool`; success `result`→`result` with `usage.costUsd`/`turns`; `is_error` transient→`error{retryable:true, providerDown:?}`. (Adapt the cases from the design; assert exact shapes.)

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** — port the switch from `engine.ts:372–573`, emitting `AgentEvent`s. `providerDown` mirrors `getChatErrorSignal` (blank/"unknown error" → true). Keep the thinking newline-boundary heuristic (`engine.ts:407–416`) inside the normalizer.

- [ ] **Step 4: Run → PASS.**

- [ ] **Step 5: Commit** `feat(agent): pure SdkNormalizer for SDK message → AgentEvent`.

### Task 1.4: `ClaudeBackend` / `ClaudeSession` over an injectable `query`

Wraps `query()` + the warm `MessageStream` + the retry loop behind `AgentSession`. `query` injected for testing.

**Files:**

- Create: `src/agent/backends/claude.ts`
- Create: `src/agent/message-stream.ts` (move `MessageStream` + `buildContentBlocks` + `SDKUserMessage` out of `engine.ts:38–159`)
- Test: `tests/agent/claude-backend.test.ts`

**Interfaces:**

- Consumes: `AgentBackend`/`AgentSession`/`AgentSessionContext` (1.2), `SdkNormalizer` (1.3), `MessageStream`, `query` type.
- Produces: `class ClaudeBackend implements AgentBackend` (`name="claude"`), constructor `new ClaudeBackend(deps?: { queryFn?: QueryFn })`; `type QueryFn`. `canResume` = the `sessionFileExists` probe. Re-exports `buildContentBlocks` from `message-stream.ts` (kept re-exported from `engine.ts` for the existing test import).

- [ ] **Step 1: Move `MessageStream`/`buildContentBlocks`/`SDKUserMessage` into `src/agent/message-stream.ts`**; `engine.ts` imports them and keeps `export { buildContentBlocks }`. Run `tests/chat/engine.test.ts` → PASS (move is neutral).

- [ ] **Step 2: Write the failing test** — fake `queryFn` yielding scripted SDK messages; assert `openSession().send()` streams `["session","text","result"]` and a retryable error triggers exactly one retry then success. (Inject `retryDelaysMs:[0,0]`.)

- [ ] **Step 3: Run → FAIL.**

- [ ] **Step 4: Implement `ClaudeBackend`/`ClaudeSession`** — port `startQuery` (`engine.ts:329–368`, options bag incl. skills/hooks/agents) + the warm-stream reuse + the retry loop (`engine.ts:526–551`), driving `SdkNormalizer`, yielding `AgentEvent`s. `send()` returns `AsyncIterable<AgentEvent>`; the session holds the warm `query()` across calls. `canResume(id, cwd)` = `sessionFileExists(id, cwd)`.

- [ ] **Step 5: Run → PASS.**

- [ ] **Step 6: Commit** `feat(agent): ClaudeBackend wrapping query() behind AgentSession`.

### Task 1.5: `getBackend` + route consumers through the seam

**Files:**

- Create: `src/agent/registry.ts` (Phase 1: `getBackend()` returns a shared `ClaudeBackend`; `resolveBackends` returns `[claude]`)
- Create: `src/agent/index.ts` (barrel re-exporting types + registry)
- Modify: `src/core/runner.ts` (`runJobWithClaude` → drive `ClaudeBackend` session; keep signature/`RunnerOutput`)
- Modify: `src/chat/engine.ts` (`createChatEngine` → open one session, `send` per message via the `AgentEvent` loop; keep `ChatEngine`/`SendResult` shape)
- Test: existing `tests/core/runner.test.ts`, `tests/chat/engine.*.test.ts` stay green

- [ ] **Step 1:** Create `registry.ts` + `index.ts`; unit-test `getBackend().name === "claude"` and singleton stability.
- [ ] **Step 2:** Capture the green baseline of the runner + engine suites.
- [ ] **Step 3:** Rewrite `runJobWithClaude` to consume `getBackend().openSession(...)` + the `AgentEvent` loop (map `thinking|progress→onActivity`, `result→RunnerOutput`, `error→error`). Move `sessionFileExists` into `ClaudeBackend`.
- [ ] **Step 4:** Rewrite `createChatEngine`'s `send`/`startQuery` to consume the session (the `AgentEvent` switch from the spec). Keep idle/long-running timers, finalizer, `ActiveEngine`, DB saves in the engine. Delete the engine-local `query`/`MessageStream`/`pending` plumbing and the inline retry (now in `ClaudeBackend`).
- [ ] **Step 5:** Run `bun run test` (full gate). Expected: green, same counts.
- [ ] **Step 6: Commit** `refactor: route engine + runner through ClaudeBackend (zero behavior change)`.

**Phase 1 done:** Claude runs through the seam; tools are one table; nothing user-visible changed. Foundation proven.

---

## Phase 2 — Loopback MCP endpoint + `CodexBackend`

Detailed steps authored when Phase 1 lands (the `AgentSession` contract must be real first). Task shape:

- **2.1 `src/agent/mcp-endpoint.ts`** — loopback `Bun.serve` (127.0.0.1, ephemeral port; unix socket if the transport supports it) hosting `@modelcontextprotocol/sdk` `WebStandardStreamableHTTPServerTransport` + low-level `Server` mapping over `NIA_TOOLS`. Per-run `mint(ctx) → {url, token}` binding an **immutable** `McpSourceContext`; `revoke(token)`. Started/stopped in `daemon.ts`. Test: a `CallTool` over the transport dispatches to the right handler with the frozen ctx; an unknown token → 401.
- **2.2 Round-trip spike** — point a real `codex exec` (or a minimal MCP client) at the endpoint; confirm a tool call executes in-daemon and returns. Gate before building the adapter.
- **2.3 `src/agent/backends/spawn.ts`** — shared helper: spawn a CLI with an env allowlist-scrub (replacing `CODEX_EXCLUDED`), register an `active-handle` that SIGKILLs the PID + revokes the token on close, and a shared async JSONL line-reader. (DRY for Codex+Gemini.)
- **2.4 `src/agent/backends/codex.ts`** — `CodexBackend`: write a per-run `[mcp_servers.nia]` config (url+token) and a system prompt; spawn `codex exec --json`; normalize JSONL → `AgentEvent` (one `CodexNormalizer`, mirroring `SdkNormalizer`); `canResume` via thread-id. Register `codex` in the registry.
- **2.5 DB + cost mapping** — `sessions.backend` + `backend_session_id` migration; `Session.getLatestWithBackend`; backend-matched resume. **Cost is NOT a free passthrough** (review Minor 10): `accumulateMetadata` (`session.ts:125-175`) is hard-coded to Anthropic's `modelUsage`/`cost_usd` shape. Each normalizer maps its native usage into the unified `AgentUsage`, and the consumer maps `AgentUsage` → the metadata keys `accumulateMetadata` expects (Codex/Gemini → token counts, `cost_usd: 0`). Keep this mapping inside the normalizer/consumer, never an `if (backend)` in the accumulator.

**Phase 2 acceptance gate (pulled forward from spec criterion 5):** a Slack-thread chat and a background job calling `send_message` concurrently each route to the correct destination — this is _the_ test that justifies the per-run frozen-context token design, so it gates Phase 2, not Phase 4. Also: token revocation is tied to the subprocess **PID exit** (reap → revoke via the `active-handle`), not only to a clean `close()`, so a crashed CLI can't leave a live bearer.

**Attachments (v1 limitation, note in 2.4/3.1):** `buildContentBlocks` makes Anthropic base64 image blocks for Claude; CLI backends get **path-hints only** (codex/gemini read the file off disk). Don't imply base64 cross-backend support the CLIs can't take.

**Phase 2 done:** a Codex job runs end-to-end with full Nia tools via the endpoint; concurrent routing verified.

---

## Phase 3 — `GeminiBackend` + failover

- **3.1 `src/agent/backends/gemini.ts`** — reuses `spawn.ts` + the JSONL reader; writes `settings.json` `mcpServers.nia` (`httpUrl`+`headers` Bearer); spawns `gemini -p --output-format stream-json`; `GeminiNormalizer` (`init`/`message`/`tool_use`/`result`); `canResume` returns false in v1 (confirm headless `-r` in a spike to enable). Register `gemini`.
- **3.2 Failover wrapper** — in `registry.ts`/a small `failover.ts`: `resolveBackends(role)` returns `[primary, ...fallbacks]` from config; the consumer runs primary, and on a terminal `error{providerDown:true}` re-opens on the next backend, replaying history from Nia's `messages` DB. Config: `backends` map + per-role/per-job/per-employee selector; remove `config.runner`.
- **3.3** — force-Claude-down integration test: a Slack chat is answered by the fallback.

**Phase 3 done:** three backends; automatic failover; config-selectable per role.

---

## Phase 4 — policy gate + hardening

- **4.1** side-effect-tool gate (`place_call`, `send_message`) at the `NIA_TOOLS` handler boundary (one gate, all backends); each CLI's own approval flag governs its built-ins.
- **4.2** global concurrency cap in `scheduler.ts`; verify subprocess reaping + token revocation on daemon restart (success criterion 6).

---

## Self-Review

**Spec coverage:** seam (1.2) ✓; one tool table/DRY (1.1) ✓; Claude in-process preserved (1.3–1.5) ✓; loopback endpoint + per-run frozen ctx (2.1) ✓; Codex (2.4) ✓; Gemini (3.1) ✓; failover (3.2) ✓; DB/resume (2.5) ✓; cost union (in `AgentUsage`, 1.2) ✓; policy + concurrency (4) ✓. The "no `if(backend===…)`" rule is enforced by routing all selection through `registry.ts`.

**Placeholder note:** Task 1.1 Step 3 shows the table shape with two full entries and an explicit "port the remaining verbatim" — the implementer copies the 19 others from `server.ts:11–374` (a mechanical, lossless move, not invented content). Phases 2–4 are deliberately roadmap-level: their bite-sized steps are authored when reached, because writing them now against the not-yet-built `AgentSession` contract would be speculative.

**Type consistency:** `AgentEvent`/`AgentUsage`/`AgentSession`/`AgentBackend`/`AgentSessionContext` defined once in 1.2 and imported unchanged everywhere. `NiaTool`/`NIA_TOOLS` (1.1) consumed by both transports. `QueryFn` local to 1.4. Each backend's normalizer (`SdkNormalizer`, `CodexNormalizer`, `GeminiNormalizer`) shares the `consume(msg): AgentEvent[]` shape.
