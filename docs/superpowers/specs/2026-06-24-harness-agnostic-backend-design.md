# Harness-Agnostic Nia — ACP as the Single Abstraction

**Date:** 2026-06-24
**Status:** Design approved (spike-confirmed); implementation not started

## Goal

Make Nia run on any ACP-speaking coding agent behind one seam, so Claude and Codex are interchangeable peers for **both jobs and chat**, with full access to Nia's tools, resilient to either provider's outage. Today execution is hardcoded to the Claude Agent SDK at two `query()` sites; Codex exists only as a tool-less `codex exec` dead-end.

After v1:

- One `AgentBackend`/`AgentSession` seam. **Both** Claude (`@agentclientprotocol/claude-agent-acp`) and Codex (`@zed-industries/codex-acp`) run as ACP agent subprocesses behind it. No Claude-SDK special path.
- Every backend reaches Nia's 21 tools via a **loopback HTTP MCP relay** the daemon hosts — tools run in-daemon with full channel/phone singleton access.
- Switching a job or chat's backend is a config change.

## Decision record

The owner chose **ACP as the single abstraction, including Claude** — over a hybrid (keep Claude on the in-process SDK) and over a jobs-only cut. This was chosen after explicit pushback (twice) on two real costs, which are accepted:

- **Inverted risk gradient:** Claude (the most stable dependency) now runs through a v0.x bridge. Accepted.
- **Lost in-process niceties:** JS `hooks` and the warm in-process `query()` go away. Mitigated below.

The adversarial pre-mortem dissented (recommended cutting the relay + chat parity). The owner chose the ambitious path; its mitigations are carried into the Risks section regardless.

**Why it's defensible:** one uniform execution + tool model across all harnesses, a clean productization story (Nia could itself expose ACP), and — critically — **the load-bearing mechanism is spike-confirmed** (below), not assumed.

## Spike findings (2026-06-24, real binaries — confirmed facts)

Probed `initialize` + `session/new` against the actual installed bridges:

|                                                         | claude-agent-acp@0.50.0           | codex-acp@0.16.0                  |
| ------------------------------------------------------- | --------------------------------- | --------------------------------- |
| `mcpCapabilities`                                       | `http:true, sse:true`             | `http:true, sse:false`            |
| **`session/new` w/ HTTP MCP + `Authorization: Bearer`** | **ACCEPTED** (returned sessionId) | **ACCEPTED** (returned sessionId) |
| resume                                                  | loadSession + resume + fork       | loadSession + resume              |
| image prompts                                           | yes                               | yes                               |
| ACP protocol version                                    | 1                                 | 1                                 |

`@agentclientprotocol/sdk@0.29.0`. **Not yet verified** (needs model creds + a live MCP server): an end-to-end tool round-trip (agent → relay → daemon handler → result). This is implementation step 1, not an assumption to build on.

## Non-goals (v1)

- **Gemini.** `gemini --acp` is stdio-only for MCP (won't take the HTTP relay). The seam keeps it addable; not built now.
- **Per-token streaming into Slack/Telegram.** Those channels are final-only today (only the REPL streams). Preserved as-is; ACP chunk cadence is irrelevant to them.
- **A backend-neutral approval UI.** The policy gate (below) is minimal: ALLOW/DENY in v1, with ASK only for interactive contexts; rich approval flows are later.
- **Phone consult's hardcoded model** (`src/channels/phone/consult.ts:31`). One-shot completion, not an agent loop. Untouched.

## Architecture

```
   ┌─────────────────────────────────────────────────────────────┐
   │  Nia daemon (one process)                                    │
   │                                                              │
   │   engine.ts / runner.ts ── one AgentEvent consume loop       │
   │            │ backend.openSession(ctx) → AgentSession         │
   │            ▼                                                 │
   │      AcpBackend ──spawn──► claude-agent-acp / codex-acp      │
   │            │ ACP JSON-RPC over stdio   (subprocess)          │
   │            │                               │                 │
   │   ┌────────▼─────────┐                     │ HTTP MCP        │
   │   │ loopback /mcp     │◄────────────────────┘ (Bearer token) │
   │   │ 127.0.0.1 relay   │   per-session Server, ctx frozen in  │
   │   │ → 21 tool handlers│   (runs IN daemon: getChannel(),     │
   │   └───────────────────┘    phone relay, DB — full access)    │
   └─────────────────────────────────────────────────────────────┘
```

The orchestration loop never branches on backend. Backend choice happens once per session via a registry.

## Components

### `src/agent/types.ts` — the seam

```ts
export interface AgentSessionContext {
  room: string;
  channel: string; // "slack" | "telegram" | "system" | ...
  systemPrompt: string;
  cwd: string;
  model?: string;
  source: McpSourceContext; // routing identity for Nia's tools (frozen per session)
  resume: boolean | string; // true = latest for room; string = explicit backend session id
  subagents?: Record<string, AgentDef>;
}

export type AgentEvent =
  | { type: "session"; backendSessionId: string }
  | { type: "text"; delta: string }
  | { type: "thinking"; delta: string }
  | { type: "tool"; name: string; summary?: string }
  | { type: "permission"; request: PermissionRequest; respond: (d: PolicyDecision) => void }
  | { type: "result"; text: string; usage: AgentUsage; backendSessionId: string }
  | { type: "error"; message: string; retryable: boolean };

export interface AgentUsage {
  costUsd?: number;
  tokens?: { input: number; output: number };
  turns?: number;
}

export interface AgentSession {
  readonly backendSessionId: string | null;
  send(text: string, attachments?: Attachment[]): AsyncIterable<AgentEvent>;
  close(): Promise<void>;
}

export interface AgentBackend {
  readonly name: "claude" | "codex";
  openSession(ctx: AgentSessionContext): Promise<AgentSession>;
  canResume(backendSessionId: string, cwd: string): Promise<boolean>;
}
```

A job is a one-send session; chat is a many-send session kept warm (the ACP subprocess is reused across turns, the ACP analog of today's `MessageStream`).

### `src/agent/backends/acp.ts` — `AcpBackend`

Spawns the bridge binary (claude-agent-acp / codex-acp) over stdio, drives `@agentclientprotocol/sdk` (`ClientSideConnection`, `ndJsonStream(stdin, stdout)`). Per turn: `session/prompt`, translating `session/update` notifications → `AgentEvent` (`agent_message_chunk`→text, `agent_thought_chunk`→thinking, `tool_call`/`tool_call_update`→tool, `session/request_permission`→permission). Resolves the turn on the `prompt` result (`stopReason`). `session/new` is given the relay's HTTP MCP config + this session's bearer (below). `cancel()` is the connection's `session/cancel` + subprocess kill. Image attachments map to ACP `ContentBlock`s. Backend identity (`claude`/`codex`) selects the spawn command and the model-namespace mapping.

### `src/agent/mcp-relay/` — the loopback tool relay

- **`server.ts`** — a dedicated `Bun.serve` on `127.0.0.1`, ephemeral port (`port: 0`), exposing `/mcp`. Started in `daemon.ts` right after `setMcpFactory` (`daemon.ts:~275`); stopped in shutdown. **Prefer a unix domain socket over TCP loopback** if Bun supports it for the MCP transport, to remove the "any local process can hit it" class (see Risks).
- **`server-factory.ts`** — `buildRelayServer(ctx)`: a low-level `@modelcontextprotocol/sdk` `Server` whose `ListTools`/`CallTool` dispatch into the **same** `handlers.*` from `src/mcp/tools/*` (extracted into a shared `src/mcp/tools/table.ts` so the Claude-ACP and any in-process path share one source of truth). Handlers run in-daemon — `getChannel()`/`getPhoneChannel()` resolve to live singletons. `CallTool` calls `runPolicyGate` first.
- **`registry.ts`** — `token → { ctx, server, transport }`. `mint(ctx)` (called at `session/new`) creates a random 256-bit bearer + a **per-session** `Server` + `WebStandardStreamableHTTPServerTransport` closing over an **immutable** `McpSourceContext` snapshot. `revoke(token)` (called at session close/crash) tears both down. Immutability + 1:1 token↔session is what prevents the thread-misrouting race.

### `src/agent/policy/` — the gate (minimal, real)

One rule engine, enforced at **one** boundary per tool class:

- **Nia's side-effect tools** (`place_call`, `send_message`) at the relay `CallTool` boundary → `runPolicyGate({tool, args, ctx})` returns allow/deny/ask.
- **The agent's own built-ins** (Codex bash/edit) via ACP `session/request_permission`. (Not double-gated with the relay — they never traverse it.)
- ASK reaches a human only in interactive (chat) contexts via the originating room; in headless jobs ASK collapses to a configured default (deny). v1 ruleset is a small array: Nia tools allow; agent built-ins ask-in-chat / allow-in-job; default allow.

### `src/agent/registry.ts` — `getBackend(name)`

Resolves config (`backends` map + role/per-job/per-employee selector) → an `AgentBackend`. Selection happens once.

### Consumers: `engine.ts`, `runner.ts` (rewrites)

Keep `ChatEngine`/`SendResult`/`EngineOptions` external shapes (channel consumers unchanged — they stay final-only). Replace both `query()` sites with `backend.openSession(ctx)` + an `AgentEvent` loop. `runJobWithCodex`/`runJobWithClaude` collapse into one `runJob` over the backend; the dead `codex exec` path is deleted. Idle/long-running timers, `finalizeSession`, `ActiveEngine`, DB saves stay in the consumer; execution + normalization move to `AcpBackend`. `runTask` (consolidator/summarizer) routes through the same `runJob`.

### DB + resume + cost

- Migration: `sessions` gains `backend TEXT NOT NULL DEFAULT 'claude'` + `backend_session_id TEXT`.
- Resume is **backend-matched**: `Session.getLatestWithBackend(room)`; resume only if `latest.backend === backend.name && await backend.canResume(...)`. The Claude `~/.claude/projects` jsonl probe (`engine.ts:173`) moves into the Claude backend's `canResume` and never runs for Codex. A backend switch mid-room → fresh session, no cross-backend resume.
- Cost: `AgentUsage` is `costUsd?` (Claude) or `tokens?` (Codex); the existing JSONB session-metadata accumulator already sums whichever keys are present. Jobs gain a cost field (today they record none).

## What moving Claude to ACP preserves vs loses

- **Preserved:** skill _enumeration_ (Nia builds the `Available skills:` prompt block itself via `scanSkills`, independent of the harness); dollar cost (`claude-agent-acp` emits `total_cost_usd` as `usage_update.cost`); subagents (`loadSession`/agent picker); model selection; session resume/fork; MCP (now via the relay).
- **Lost / changed:** the in-process JS `hooks` (the `gh pr merge` `PreToolUse` warning, `sdk-hooks.ts`) → re-expressed as an ACP `request_permission` policy rule; the warm in-process `query()` → an ACP subprocess kept warm per session (cold-start on the first turn of each session). Per-skill gating/observability over ACP is opaque (acceptable — Nia gates via its own tools + prompt).

## Migration

- **Phase 0 — spike round-trip (≤1 day).** Stand up a minimal relay + drive one ACP agent through one real tool call end-to-end (needs creds). Confirms the one unverified link before committing. If HTTP MCP round-trip fails for a bridge, fall back to a stdio MCP proxy for that backend (the unix-socket variant).
- **Phase 1 — the seam + relay.** `AgentBackend`/`AgentSession`/`AgentEvent`, the loopback relay + registry + `tools/table.ts`, `AcpBackend` for **Codex** first (it already lacks tools — biggest win, lowest regression risk), the policy gate, the DB column. One Codex job runs end-to-end with full tools. **De-risk goal met.**
- **Phase 2 — Claude onto ACP.** Add the Claude backend via `claude-agent-acp`; migrate chat + jobs; delete the SDK `query()` path and `sdk-hooks` (→ policy rule). Validate skills/cost/resume parity in the wild.
- **Phase 3 — config + polish.** Per-job/per-employee backend selection; Gemini if wanted; extract `@nia/agent-runtime` if productizing.

## Risks (carried, owner-accepted)

- **Loopback relay security — HIGH.** It can `place_call`/`send_message` as the owner, and the bearer is handed to a third-party agent subprocess running model-generated bash. Mitigations: unix socket over TCP where possible; short-TTL / per-session tokens revoked on close; reap subprocesses on revoke; the policy gate hard-allowlists side-effect verbs; no rate-limit primitive exists today — add one for the MCP path.
- **Per-session context-threading race — HIGH if done wrong.** The token↔ctx mapping must be immutable and 1:1 with a session (snapshot, never mutate, never reuse) or Slack thread replies misroute silently. The per-session `Server` design reproduces today's closure safety by construction.
- **Subprocess fleet — MEDIUM.** Jobs + chat each spawn agent subprocesses (+ their own tool subprocesses). `scheduler.ts` has no global concurrency cap — add one. Every ACP subprocess must register an `active-handle` whose close SIGKILLs the PID, or daemon restart leaks zombies holding tokens.
- **Dependency churn — HIGH for a solo dev.** `@agentclientprotocol/sdk` (v0.x), `claude-agent-acp` (v0.x, wraps the SDK), `codex-acp` (third-party, just renamed to `@agentclientprotocol/codex-acp`, pinned to a Codex Rust tag). Pin everything; expect breakage; the seam keeps blast radius to `src/agent/`.
- **Unverified tool round-trip.** Phase 0 closes this; do not skip it.

## Success criteria (v1 = Phases 1–2)

1. A Codex job runs to completion with full Nia tools (incl. `send_message` to deliver its result), via the relay.
2. Claude chat + jobs run over ACP with skills, dollar cost, and resume intact — behavior parity with today.
3. Switching a job's backend (claude↔codex) is a config change; no `if (backend === …)` in the orchestration loop.
4. A Slack-thread chat and a background job calling `send_message` concurrently each route to the correct destination (no context-threading race).
5. Daemon restart reaps all ACP subprocesses and revokes all relay tokens.
