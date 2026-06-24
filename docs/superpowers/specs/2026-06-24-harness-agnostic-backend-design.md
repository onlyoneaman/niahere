# Harness-Agnostic Nia — MCP-Hybrid, Failover-First

**Date:** 2026-06-24
**Status:** Design approved (spike-confirmed); implementation not started

## Goal

Make Nia run on any of several coding-agent harnesses behind one seam, so that **if Claude is down, Codex or Gemini takes over everything — chat included** — and so a backend can be chosen deliberately per role. Today execution is hardcoded to the Claude Agent SDK at two `query()` sites; Codex exists only as a tool-less `codex exec` dead-end.

After v1:

- One `AgentBackend`/`AgentSession` seam. The orchestration loop consumes only a normalized `AgentEvent` stream and never branches on backend.
- **Three backends**: Claude (in-process, via the Agent SDK — the primary fast path, unchanged), Codex (`codex exec`), Gemini (`gemini`). Codex and Gemini run as spawned CLIs and reach **the same tool table** over MCP.
- **Automatic failover**: when Claude errors as provider-down (after retries), the request re-runs on a configured fallback backend — chat or job.
- Adding a 4th backend is one self-contained adapter file, not a patch sprinkled through the code.

## Why this shape

Two prior directions were explored and rejected:

- **ACP as the single abstraction** (Claude + Codex over the Agent Client Protocol, tools via a loopback ACP relay): rejected. It forces the in-process Claude path to "phone home" over a protocol for tools it can call directly today (pure regression on the hot path), routes the most stable dependency through v0.x third-party bridges, and adds a per-session token-registry that is a context-routing race risk.
- **Model-API layer** (own the loop, call raw model APIs, e.g. Vercel AI SDK): rejected. It discards exactly what we want to keep — each harness's built-in behaviors (Claude Code's skills/subagents/file tools, Codex's & Gemini's sandboxes). The agent loop was never the value; the harness is.

The chosen shape — **MCP-hybrid** — is what mature systems (Hermes Agent, Goose, omnigent) converge on: keep the primary backend in-process native, run other harnesses as their own processes, and give every backend the **same tool table** through MCP, which every harness already speaks as a client. The decisive enabler in our code: Nia's tools are _already_ an MCP server (`createSdkMcpServer`), so "one tool table, multiple transports" is a wrapper, not a rewrite.

**Spike-confirmed (2026-06-24, real binaries):** Codex (`[mcp_servers.*]` TOML, stdio + Streamable HTTP) and Gemini (`settings.json` `mcpServers`, `httpUrl` + `headers` Bearer) are both first-class MCP clients that connect to a host-provided MCP server. Codex emits `--json` JSONL events; Gemini emits `--output-format stream-json` JSONL events — both normalize cleanly to `AgentEvent`.

**Round-trip CONFIRMED end-to-end (real codex 0.142.0):** a loopback Streamable-HTTP MCP endpoint on `@modelcontextprotocol/sdk@1.27.1`'s `WebStandardStreamableHTTPServerTransport` + `Bun.serve` works. `codex exec -c mcp_servers.nia.url=… -c mcp_servers.nia.bearer_token_env_var=…` connected, the endpoint validated the `Authorization: Bearer` header, the tool handler ran **in-process**, and codex returned the result. The Phase 2 mechanism is verified, not assumed.

## The design principle (the no-weird-patches rule)

**The orchestrator speaks only `AgentEvent` and treats the backend session id as opaque. Everything backend-specific lives inside one adapter.** Concretely the interface guarantees:

1. **One event vocabulary, normalized in the adapter.** Raw CLI/SDK output never reaches a consumer, so there is never an `if (backend === …)` in `engine.ts`/`runner.ts`.
2. **MCP wiring is an adapter responsibility.** The orchestrator hands an adapter a frozen `McpSourceContext` + the relay's `{url, token}`; the adapter serializes it into its own dialect (Claude: in-process SDK server; Codex: TOML `[mcp_servers.nia]`; Gemini: `settings.json` `mcpServers.nia`).
3. **Resume is a per-backend boolean.** The orchestrator stores an opaque id and asks `backend.canResume(id, cwd)`. It never knows it's a `.jsonl` path (Claude), a `thread_id` (Codex), or a `sessionId` (Gemini). Unknowns (e.g. Gemini headless resume) become `return false` → fresh session with replayed context, not an orchestrator special-case.

The three genuine differences between CLI backends (MCP-config dialect, JSONL field names, resume surface) are each fully localizable to one adapter. That is what keeps it clean.

## Non-goals (v1)

- **ACP and the `*-acp` bridges.** Not used. If warm streaming for a _deliberately-primary_ Codex/Gemini chat is ever wanted, an ACP adapter can be added behind the same seam later.
- **Per-token streaming into Slack/Telegram.** Those channels are final-only today (only the REPL streams), so a batch CLI backend serves them with identical UX. The REPL degrades to a final dump on subprocess backends — acceptable (local, and only when a non-Claude backend is active).
- **A rich approval UI.** The policy gate is minimal: Nia's side-effect tools gated at the tool boundary; each CLI's own approval flag governs its built-ins.
- **Phone consult's hardcoded model** (`src/channels/phone/consult.ts:31`). One-shot completion, not an agent loop. Untouched.

## Architecture

```
   ┌──────────────────────────────────────────────────────────────┐
   │ Nia daemon (one process)                                      │
   │                                                               │
   │  engine.ts / runner.ts ── one AgentEvent loop, no backend ifs │
   │        │ backend.openSession(ctx) → AgentSession              │
   │        ▼                                                      │
   │  ┌───────────────┐  ┌──────────────────┐  ┌────────────────┐  │
   │  │ ClaudeBackend │  │  CodexBackend    │  │ GeminiBackend  │  │
   │  │ in-process    │  │  spawn codex exec│  │ spawn gemini -p│  │
   │  │ Agent SDK     │  │  --json          │  │ stream-json    │  │
   │  │ in-proc MCP   │  │  TOML mcp config │  │ json mcp config│  │
   │  └──────┬────────┘  └────────┬─────────┘  └───────┬────────┘  │
   │         │ in-process          │ HTTP MCP           │ HTTP MCP  │
   │         │                     ▼                    ▼           │
   │         │            ┌────────────────────────────────┐       │
   │         └───────────►│  ONE tool table (NIA_TOOLS)     │       │
   │      (same handlers) │  served in-proc + loopback HTTP │       │
   │                      │  per-run frozen McpSourceContext│       │
   │                      └────────────────────────────────┘       │
   └──────────────────────────────────────────────────────────────┘
```

## Components

### `src/agent/types.ts` — the seam (depend on abstractions)

```ts
export interface AgentSessionContext {
  room: string;
  channel: string;
  systemPrompt: string;
  cwd: string;
  model?: string;
  source: McpSourceContext; // frozen routing identity for Nia's tools
  resume: boolean | string;
  subagents?: Record<string, AgentDef>;
}

export type AgentEvent =
  | { type: "session"; backendSessionId: string }
  | { type: "text"; delta: string }
  | { type: "thinking"; delta: string }
  | { type: "tool"; name: string; summary?: string }
  | { type: "result"; text: string; usage: AgentUsage; backendSessionId: string }
  | { type: "error"; message: string; retryable: boolean; providerDown: boolean };

export interface AgentUsage {
  costUsd?: number;
  tokens?: { input: number; output: number };
  turns?: number;
}

export interface AgentSession {
  /** Re-read after each send(): a new session assigns it on the first turn,
   *  and an internal retry may rotate it. Engine threads this value into
   *  finalizer/DB. */
  readonly backendSessionId: string | null;
  /** Streams the turn's events. Emits exactly ONE `session` event per send
   *  even across internal retries, so the consumer can save the user message
   *  idempotently. Ends with `result` or `error`. */
  send(text: string, attachments?: Attachment[]): AsyncIterable<AgentEvent>;
  /** Interrupt an in-flight send; teardown+restart on retry is atomic w.r.t.
   *  this. Engine registers it via registerActiveHandle. */
  abort(reason: string): void;
  close(): Promise<void>;
}

export interface AgentBackend {
  readonly name: "claude" | "codex" | "gemini";
  openSession(ctx: AgentSessionContext): Promise<AgentSession>;
  canResume(backendSessionId: string, cwd: string): Promise<boolean>;
}
```

A job is a one-send session; chat is a many-send session. `providerDown` on the error event is the failover trigger (mirrors today's `getChatErrorSignal`).

### `src/mcp/tools/table.ts` — ONE tool table (DRY)

Extract the 21 tool definitions (name, description, zod schema, handler) out of `src/mcp/server.ts` into a single exported `NIA_TOOLS` array. Both transports consume it:

- `createNiaMcpServer(ctx)` (existing in-process SDK server, for Claude) maps over `NIA_TOOLS` — no behavior change.
- The loopback relay (below) maps over the **same** `NIA_TOOLS`.
  Handlers in `src/mcp/tools/*` are untouched; they keep their daemon-singleton access (`getChannel`, phone relay, DB).

### `src/agent/mcp-endpoint.ts` — the loopback tool endpoint (for subprocess backends only)

A `127.0.0.1` HTTP server (ephemeral port) using `@modelcontextprotocol/sdk`'s `WebStandardStreamableHTTPServerTransport` + low-level `Server`, dispatching into `NIA_TOOLS`. Started in `daemon.ts` after `setMcpFactory`; stopped in shutdown.

- **Per-run frozen context (no shared-registry race):** each subprocess run mints a token bound to an **immutable** `McpSourceContext` snapshot; the adapter passes `{url, token}` to its CLI. `send_message` thread routing reads the frozen context — identical safety to today's per-query closure. Token revoked when the run's session closes.
- Prefer a unix domain socket over TCP loopback if the transport supports it (removes the "any local process" surface); otherwise loopback + the per-run bearer.
- Handlers run **in-daemon** — the CLI only sends JSON-RPC frames over the wire.

### `src/agent/backends/claude.ts` — `ClaudeBackend` (primary, in-process)

Owns today's `query()` + warm `MessageStream` + retry + the SDK-event→`AgentEvent` normalization (extracted from `engine.ts:329–601` / `runner.ts:112–270`). Tools via the **in-process** SDK MCP server (no relay, no round trip). `canResume` = the `~/.claude/projects/<cwd>/<id>.jsonl` probe (moved out of `engine.ts:173`). Behavior-preserving extraction.

### `src/agent/backends/codex.ts` — `CodexBackend`

Spawns `codex exec <prompt> --json -C <cwd>` with an auto-approve flag and a written `[mcp_servers.nia]` config (`url` + bearer) pointing at the loopback endpoint. Parses JSONL (`thread.started`→session id, agent_message→text, tool/reasoning events→tool/thinking) into `AgentEvent`. `canResume` = thread-id resume if available, else false. Env: a shared spawn helper applies the credential-scrub allowlist (replacing the ad-hoc `CODEX_EXCLUDED`).

### `src/agent/backends/gemini.ts` — `GeminiBackend`

Spawns `gemini -p <prompt> --output-format stream-json` with an auto-approve flag and an `mcpServers.nia` entry (`httpUrl` + `headers: Authorization Bearer`). Parses JSONL (`init`→session id, `message`→text, `tool_use`/`tool_result`→tool, `result`→result) into `AgentEvent`. `canResume` = false in v1 (headless resume unconfirmed — see Risks) → fresh-with-replayed-context. Same shared spawn/env helper.

### `src/agent/registry.ts` — backend selection + failover

- `getBackend(name)` → an `AgentBackend` instance (singletons; subprocess backends are stateless factories).
- `resolveBackends(role)` → an **ordered list** `[primary, ...fallbacks]` from config (`backends` map + per-role/per-job/per-employee selector). Selection happens once per request.
- **Failover** is a thin wrapper the consumer uses: run the primary; on a terminal `error` event with `providerDown: true` (after the backend's own retries), re-open the session on the next backend in the list with the same context, replaying conversation history from Nia's DB. No cross-backend session resume is attempted (different id spaces); continuity comes from Nia's own `messages` transcript.

### Consumers: `src/chat/engine.ts`, `src/core/runner.ts` (rewrites)

Keep `ChatEngine`/`SendResult`/`EngineOptions` external shapes (channels unchanged, still final-only). Replace both `query()` sites with `resolveBackends(role)` + the failover wrapper + an `AgentEvent` loop. `runJobWithClaude`/`runJobWithCodex` collapse into one `runJob`; the global `config.runner` switch is removed (migrate config by hand — no compat shim). `runTask` (consolidator/summarizer) routes through the same path. Idle/long-running timers, finalizer, `ActiveEngine`, DB saves stay in the consumer.

### DB + cost

- Migration: `sessions` gains `backend TEXT NOT NULL DEFAULT 'claude'` + `backend_session_id TEXT`. Resume is backend-matched via `Session.getLatestWithBackend(room)` + `backend.canResume(...)`; a backend switch mid-room → fresh session.
- `AgentUsage` is `costUsd?` (Claude/Gemini if available) or `tokens?` (Codex); the existing JSONB session-metadata accumulator already sums whichever keys are present. Jobs gain a cost field.

### Policy / permission (minimal, one gate)

- **Nia's side-effect tools** (`place_call`, `send_message`) gated once, at the `NIA_TOOLS` handler boundary (covers all backends and both transports).
- **Each CLI's own built-ins** (Codex/Gemini bash/edit) governed by that CLI's approval flag, not double-gated through Nia.

## Migration (each phase ships independently testable software)

- **Phase 1 — seam + Claude extraction (behavior-preserving).** `AgentBackend`/`AgentEvent`, extract `NIA_TOOLS`, `ClaudeBackend` (wraps today's query()+warm stream+retry+normalization), route `engine.ts`/`runner.ts` through it with Claude as the only backend. Zero behavior change. De-risks the riskiest rewrite first.
- **Phase 2 — loopback MCP endpoint + CodexBackend.** Stand up the endpoint (per-run frozen context), a round-trip spike (agent→endpoint→handler→result), then `CodexBackend`. One Codex job runs end-to-end with full tools. Add `backend` DB column + backend-matched resume.
- **Phase 3 — GeminiBackend + failover.** `GeminiBackend` (proves the adapter pattern — minimal new code). The `resolveBackends`/failover wrapper; auto-fallback on `providerDown`. Per-role/per-job config selection.
- **Phase 4 — policy gate + polish.** The side-effect-tool gate; concurrency cap; subprocess reaping on daemon restart.

## Risks (carried)

- **Loopback MCP endpoint — MEDIUM.** Necessary (external agents must reach host tools), but it can `place_call`/`send_message` as the owner and the bearer is handed to a subprocess. Mitigate: unix socket over TCP where possible; per-run immutable tokens revoked on close; the side-effect-tool gate; reap subprocesses on revoke. It is plain MCP with per-run-frozen context — no ACP, no shared mutable registry.
- **Gemini headless resume unconfirmed — LOW.** v1 `canResume` returns false (fresh-with-replayed-context); confirm `-r`/`--resume` from a `-p` call in the Phase 3 spike to enable real resume.
- **CLI output-format coupling — MEDIUM.** Codex `--json` and Gemini `stream-json` event schemas can change between releases. Contained: parsing lives in one adapter each; pin CLI versions; the `AgentEvent` contract is the firewall.
- **Subprocess fleet — MEDIUM.** `scheduler.ts` has no global concurrency cap — add one. Every spawned CLI registers an `active-handle` whose close SIGKILLs the PID and revokes its token, or daemon restart leaks zombies.
- **Failover continuity — LOW.** A failover starts a fresh session on the fallback backend, rebuilding context from Nia's DB transcript (the dead primary session can't resume). Acceptable; it's an outage path.

## Success criteria (v1)

1. Claude chat + jobs behave identically to today (the `ClaudeBackend` extraction is invisible).
2. A Codex job and a Gemini job each run to completion with full Nia tools (incl. `send_message` to deliver results).
3. With Claude forced down, a Slack chat is answered by the configured fallback backend automatically.
4. No `if (backend === …)` branch exists in the orchestration loop; adding a backend is one adapter file.
5. A Slack-thread chat and a background job calling `send_message` concurrently route to the correct destination (per-run frozen context — no race).
6. Daemon restart reaps all CLI subprocesses and revokes all endpoint tokens.
