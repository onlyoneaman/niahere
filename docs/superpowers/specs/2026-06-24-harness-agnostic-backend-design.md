# Harness-Agnostic Agent Backend — `AgentBackend`

**Date:** 2026-06-24
**Status:** Design approved, implementation not started

## Goal

Today Nia's agent execution is hardcoded to the Claude Agent SDK at ~4 call sites. Introduce one seam — `AgentBackend` — so Nia can run on a non-Claude harness without rewriting, and survive a Claude outage, pricing change, or quality regression on at least one fallback path.

Concretely, after v1:

- One `AgentBackend` interface with **two implementations**: `SdkBackend` (current Claude Agent SDK, in-process) and `AcpBackend` (Codex, out-of-process over the Agent Client Protocol).
- A **job** can run on Codex end-to-end, with the daemon delivering its result (a new, explicit delivery step — see below), proving the seam.
- Claude is untouched in behavior — same streaming, dollar cost, skills, in-process debugging.

## Why this shape (decision record)

The ambitious option — make ACP the _single_ abstraction and route even Claude through the `claude-agent-acp` bridge, with full chat+jobs parity across Claude/Codex/Gemini — was evaluated and **rejected** after an adversarial review. Three findings drove the call:

1. **MCP tools are not pure functions.** `send_message` (`src/mcp/tools/send.ts:97`) and `place_call` (`src/mcp/tools/misc.ts:38`) are RPCs into live daemon singletons (channel registry, Twilio↔OpenAI phone relay). ACP agents reach tools only via an out-of-process stdio MCP server. Moving tools out of the daemon silently degrades proactive Slack thread replies, watch responses, and voice to text DMs. Solving it generally requires a daemon-RPC bridge — a project in itself. Keeping Claude in-process avoids this entirely.
2. **Inverted risk gradient.** ACP-only would route the _most stable_ dependency (the Claude Agent SDK, first-party) through the _least_ stable layer (v0.x just-renamed bridge + a third-party Codex adapter pinned to a Codex Rust tag) — to de-risk the dependency that is already most reliable.
3. **Feasibility is not the blocker.** The ACP client works as assumed; this is a strategy call, not a capability gap. So we keep ACP as one implementation, not the universe.

"One abstraction, two implementations" is the textbook justification for the seam — and it formalizes the split that already exists today (`runJobWithClaude` vs `runJobWithCodex`). The asset worth eventually open-sourcing is `AgentBackend` itself — proven to normalize two genuinely different execution models to Nia's own domain types — which is more valuable than an ACP-only wrapper that inherits four unstable packages as bug reports. **Bet the interface, not the protocol.**

## Non-goals (v1)

- **Claude over ACP.** Claude stays on the in-process SDK. No `claude-agent-acp` dependency.
- **Chat parity on Codex.** Interactive Slack/Telegram/REPL chat stays Claude-only. ACP is jobs-first (async, latency-tolerant — where subprocess warts don't hurt).
- **Gemini** (or any third backend). Added later once the seam is proven on Codex.
- **The daemon-RPC bridge / full tool access for ACP jobs.** v1 ACP jobs get a DB-safe tool subset; the daemon delivers their final output via a **new explicit delivery step** (today the agent self-delivers by calling `send_message` mid-run — that path is daemon-bound and excluded for ACP). Rich out-of-process tooling (`send_message`, `place_call` from inside a Codex job) is deferred.
- **A backend-neutral policy gate (ALLOW/DENY/ASK).** Designed-for, not built. ACP hands us `session/request_permission` for free when we want it; the portable choke point is the MCP-handler boundary. Out of scope for v1.
- **Phone consult's hardcoded model** (`src/channels/phone/consult.ts:31`, `claude-sonnet-4-6`). It's a one-shot completion, not an agent loop. Untouched.

## Architecture

```
                        ┌──────────────────────────────────────────────┐
                        │  Nia orchestration (engine.ts / runner.ts)    │
                        │  one consume loop, zero `if (backend === …)`  │
                        └───────────────────────┬──────────────────────┘
                                                │ backend.startSession(ctx) → AgentSession
                                                │ session.send(turn) → AsyncIterable<AgentEvent>
                        ┌───────────────────────┴──────────────────────┐
                        │                                               │
              ┌─────────▼──────────┐                      ┌─────────────▼─────────────┐
              │   SdkBackend       │                      │      AcpBackend           │
              │  (Claude, default) │                      │  (Codex, jobs-first)      │
              │  in-process query()│                      │  spawns codex-acp subproc │
              │  rich: hooks/agents│                      │  @agentclientprotocol/sdk │
              │  /skills/$cost     │                      │  stdio JSON-RPC client    │
              └─────────┬──────────┘                      └─────────────┬─────────────┘
                        │ SDK events                                    │ session/update
                        └───────────────► normalize ◄───────────────────┘
                                          AgentEvent (Nia domain type)
```

## The interface (session-shaped)

A turn-shaped `runTurn` models a one-shot job but **not** the warm chat engine, which reuses one `query()` subprocess across many `send()` calls (the whole point of `MessageStream`, `engine.ts:127`). A turn-shaped interface would force chat to either respawn per turn (a behavior regression) or bypass the seam entirely. So the seam is **session-shaped**: a job is a one-send session; chat is a many-send session. Both route through the same interface — this is what makes success criterion #4 true for the chat hot path, not just jobs.

```ts
// src/agent/backend.ts
export interface AgentBackend {
  readonly id: "claude-sdk" | "codex-acp" | string;
  readonly capabilities: BackendCapabilities;
  /** Open a session. Chat keeps it warm across turns; a job opens, sends once, closes. */
  startSession(ctx: SessionContext): AgentSession;
}

export interface AgentSession {
  readonly sessionId: string | null; // known after the first turn's `session` event
  /** Run one turn. Streams events; ends with a `result` or `error` event.
   *  Subsequent sends reuse the same warm backend (SdkBackend: the live query()). */
  send(turn: TurnInput): AsyncIterable<AgentEvent>;
  /** Out-of-band (ACP cancel is a connection method); normalizes to an
   *  `{ kind:"error", ... }` or `result` event carrying stopReason:"aborted". */
  cancel(): void;
  close(): Promise<void>; // tears down the subprocess / query() handle
}

export interface SessionContext {
  systemPrompt: string;
  cwd: string;
  model?: string; // resolved to the active backend's namespace BEFORE the session opens
  resume?: { sessionId: string } | null;
  subagents?: AgentDef[]; // capability-gated; SdkBackend only
}

export interface TurnInput {
  userText: string;
  attachments?: Attachment[];
  signal?: AbortSignal;
}

export interface BackendCapabilities {
  streamingText: boolean; // claude:true  codex:true(via ACP)
  streamingThinking: boolean; // claude:true  codex:varies — gap is SYNTHESIZED, never a new event shape
  sessionResume: boolean; // capability-gated; read from ACP initialize response, fallback to newSession
  dollarCost: boolean; // claude:true  codex:false (tokens only → priced client-side)
}
```

A **job** = `startSession` → one `send` → `close`. **Chat** = `startSession` once → `send` per message → `close` on idle/finalize. New backend features become new `SessionContext`/`TurnInput`/`AgentEvent` fields — never a signature change.

## The normalized event vocabulary (ACP-mirrored, minimal)

Nia consumes only a handful of things today; keep the enum tight and name variants after ACP's `session/update` so a future ACP-export is a thin mapping, not a rewrite. Capability gaps are absorbed by emitting the _same_ events non-incrementally (Vercel's `simulateStreaming` trick) — the consumer can't tell a non-streaming backend apart.

```ts
// src/agent/events.ts
export type AgentEvent =
  | { kind: "session"; sessionId: string } // ACP thread.started / SDK system:init
  | { kind: "text"; delta: string; cumulative: string } // agent_message_chunk / text_delta
  | { kind: "thinking"; line: string } // agent_thought_chunk (synthesized if absent)
  | { kind: "tool"; id: string; name: string; status: ToolStatus } // tool_call + tool_call_update
  | { kind: "progress"; line: string } // tool_progress / plan
  | { kind: "result"; text: string; cost: ResultCost; stopReason: string }
  | { kind: "error"; message: string; retryable: boolean };

export type ToolStatus = "pending" | "in_progress" | "completed" | "failed";
export type ResultCost =
  | { kind: "dollars"; usd: number; turns: number; usage?: unknown }
  | { kind: "tokens"; input: number; output: number }; // priced client-side via a token table
```

Making cost a `dollars | tokens` union (not a bare number) is what keeps a tokens-only backend a first-class shape rather than a special case — and keeps the seam reversible.

## Components

### `src/agent/backend.ts`, `src/agent/events.ts`

Interfaces + the event union above. No SDK or ACP imports.

### `src/agent/backends/sdk.ts` — `SdkBackend` (Claude, default)

The `SdkBackend` session **owns the warm `query()` + `MessageStream`** (`engine.ts:127`), the retry/respawn loop (`engine.ts:~526–551`), event normalization (`content_block_delta`/`thinking_delta`/`tool_use_summary`/`result` → `AgentEvent`, in `startQuery`'s consume loop ~`engine.ts:372–600`), abort via `queryHandle.close()`, and `total_cost_usd` → `ResultCost.dollars`. The **engine** retains session-lifecycle concerns that aren't per-turn: idle/long-running timers (`engine.ts:32–33,254–302`), `finalizeSession`, and `registerActiveHandle` abort routing — it delegates execution to the session and keeps the lifecycle.

This is **behavior-preserving but not a trivial move**: the existing consume loop is fused to multi-turn state (warm subprocess, retry, `pending`), so the extraction is wrapping that machinery into `AgentSession`, not relocating a code block. Success: Claude behaves identically (criterion #1).

### `src/agent/backends/acp.ts` — `AcpBackend` (Codex)

Spawns the agent as a stdio subprocess and drives `@agentclientprotocol/sdk` (~v0.29). Four corrections from the real SDK source (verified):

1. `ndJsonStream(output=child.stdin, input=child.stdout)` — arg order is (writable-to-agent, readable-from-agent).
2. `requestPermission` is a **request/response** — return `{outcome:{outcome:"selected", optionId}}` chosen from the agent's offered `options[]`, or `{outcome:{outcome:"cancelled"}}`. v1: auto-select the allow option (no gate yet).
3. `cancel({sessionId})` is a connection method, exposed as the `cancel` handle alongside the iterable.
4. Resume is capability-gated: read `initialize` → `agentCapabilities`, use `resumeSession`/`loadSession` only if advertised, else `newSession`. Same `cwd` required.

Bridges the callback-style `sessionUpdate` into the async iterable via a small queue. Codex spawn: `@zed-industries/codex-acp` (pin the version; it's third-party glue over a Codex Rust tag — treat as a managed risk).

Headless client: advertise `clientCapabilities: { fs: { readTextFile:false, writeTextFile:false } }` and no terminal; omit those handlers. Agents do their own file IO against the real `cwd`.

### `src/agent/index.ts` — `getBackend(role)`

Resolves config → a backend instance. Backend selection happens **once** per turn; nothing downstream branches on it.

### `src/agent/tools.ts` — DB-safe tool subset for ACP jobs

v1 ACP jobs are exposed only the tools whose handlers touch pure DB/file IO, via a minimal stdio MCP server (`nia mcp-serve`). **Only two of the 21 tools are genuinely daemon-bound and excluded:** `send_message` (channel registry singleton, `send.ts:97`) and `place_call` (phone relay singleton, `misc.ts:38`). Everything else is includable — including the four **watch** tools (`watch.ts`), which only read/write config YAML; a Codex job can call `add_watch_channel` safely, it just won't observe the daemon's `SlackWatchReloader` pick up the change in its own process (fine). The documented exclusion list (exactly those two) lives here.

Because `send_message` is excluded, a Codex job cannot self-deliver its result — so the daemon must deliver it explicitly (see the runner rewrite).

### `src/chat/engine.ts`, `src/core/runner.ts` (rewrites)

Keep `createChatEngine`/`ChatEngine`/`SendResult` external shape (consumers in `repl.ts`, `cli/index.ts`, `channels/common/chat-session.ts` unchanged). The engine opens a `startSession` once and `send`s per message, consuming the normalized-event switch. `runJobWithClaude`/`runJobWithCodex` collapse into one `runJob` (open → one send → close). The dead Codex stdout-buffering path is deleted.

Three things the collapse must preserve:

- **Explicit ACP-job delivery.** Today the scheduler only logs `result.status` (`scheduler.ts:59–68`); a scheduled job reaches the owner solely because the agent calls `send_message` itself. Since ACP jobs can't, `runJob` must, for `AcpBackend` results, call in-daemon `sendMessage(...)` with the returned text. (Claude jobs keep self-delivering — a deliberate, documented per-backend difference.)
- **`runTask` keeps routing to the Claude path.** The consolidator/summarizer call `runTask` (`runner.ts:~289`), which goes through the Claude SDK path. The collapse must not break that — those background tasks stay on `SdkBackend`.
- **`config.runner` is removed.** The old global `config.runner === "codex"` switch (`runner.ts:362`) is deleted in favor of the per-role `backends` map; migrate config by hand (no compat shim, per project convention).

### Config + DB

- Config gains `backends: { <id>: {…} }` + a role map (`chat`, `job`, `employee`, `summarize`, `title`) → `"backend/model"`. Secrets stay in env.
- `sessions` table gains a **`backend` column**. Resume is gated on backend match at **both** sites: the SDK disk probe `sessionFileExists` (`engine.ts:173`, a `~/.claude/projects/…jsonl` check a Codex `thread_id` always fails) must only run for `claude-sdk` sessions, and the Slack thread-activation heuristic (`slack.ts:236`) must not treat a wrong-backend session as active.

## Migration (strangler — no flag day)

- **Phase 0:** Land `AgentBackend`/`AgentSession` + `AgentEvent` + `SdkBackend` as the _only_ backend; route chat and jobs through it. Behavior-preserving (not a trivial move — see `SdkBackend`). De-risks the riskiest rewrite first.
- **Phase 1:** Build `AcpBackend` (Codex) + `nia mcp-serve` (DB-safe tools) + the `backend` column + the explicit ACP-job delivery step. Wire one job to run on Codex end-to-end and report back. **De-risk goal met here.**
- **Phase 2 (later):** Add the policy gate (`request_permission` + MCP-handler boundary), then Gemini, then evaluate chat parity — each behind evidence, not speculation.
- **Phase 3 (deferred):** Extract `@nia/agent-runtime` once the interface is stable across ≥2 backends.

## Known risks / residual gaps (carried, not solved in v1)

- **Codex jobs have a limited toolset** (DB-safe only) until the daemon-RPC bridge exists. Acceptable for a fallback; document it.
- **No dollar cost for Codex** — tokens only, priced client-side via a token table; numbers will be estimates.
- **Subprocess lifecycle**: `AcpBackend` must track PIDs and process-group-kill on abort/daemon-restart, or leak zombies. The existing `runJobWithCodex` has _no_ abort wired — fix that in the new path. `cancel()` must normalize to the same post-abort event the Claude path produces (`terminal_reason:"aborted"` → `RunnerOutput`, `runner.ts:~246–252`), so orchestration's abort handling stays backend-uniform.
- **Young, churning deps**: `@agentclientprotocol/sdk`, `@zed-industries/codex-acp` are v0.x and recently renamed. Pin versions; expect breakage; the seam keeps blast radius to one file.
- **Hooks don't cross to ACP**: the `gh pr merge` `PreToolUse` warning (`sdk-hooks.ts:39`) stays Claude-only (advisory). Hard gating, when built, lives at the MCP-handler boundary.

## Success criteria (v1)

1. Claude chat + jobs behave identically to today (the `SdkBackend` extraction is invisible).
2. A configured job runs to completion on Codex via `AcpBackend`, and the daemon delivers its result to the owner's channel via the explicit ACP-job delivery step.
3. Switching a job's backend is a config change, not a code change.
4. The chat engine and the job runner both drive execution through `AgentBackend`/`AgentSession`; no `if (backend === …)` branch exists in the orchestration loop.
5. Consolidator/summarizer (`runTask`) and all Claude behavior are unaffected.
