import type { Attachment } from "../types/attachment";
import type { McpSourceContext } from "../mcp";

/**
 * The harness-agnostic execution seam. The orchestrator (engine.ts / runner.ts)
 * depends only on these abstractions and the `AgentEvent` stream — it never
 * branches on which backend is running. Everything backend-specific lives inside
 * one adapter under `src/agent/backends/`.
 */

/** A subagent definition, mirroring `getAgentDefinitions()` (Claude-only feature). */
export interface AgentDef {
  description: string;
  prompt: string;
  model?: string;
}

/** Normalized token/cost usage. A union so a tokens-only backend (Codex/Gemini)
 *  is first-class, not a special case. */
export interface AgentUsage {
  costUsd?: number;
  tokens?: { input: number; output: number };
  turns?: number;
}

/**
 * The normalized event vocabulary every backend maps its native stream into.
 * Adapters emit these; consumers switch on `type` and nothing else.
 *
 * - `session`: emitted exactly ONCE per `send()`, even across internal retries,
 *   so the consumer can persist the user message idempotently.
 * - `text`/`thinking`: streamed reply / status (→ onStream / onActivity).
 * - `tool`: a tool-call activity line.
 * - `result`/`error`: terminal events ending a turn.
 * - `error.retryable` (transient API failure → the backend may retry internally)
 *   and `error.providerDown` (the provider is unavailable → failover trigger) are
 *   INDEPENDENT predicates.
 */
export type AgentEvent =
  | { type: "session"; backendSessionId: string }
  | { type: "text"; delta: string }
  | { type: "thinking"; delta: string }
  | { type: "tool"; name: string; summary?: string }
  | { type: "result"; text: string; usage: AgentUsage; backendSessionId: string }
  | { type: "error"; message: string; retryable: boolean; providerDown: boolean };

export function isResultEvent(ev: AgentEvent): ev is Extract<AgentEvent, { type: "result" }> {
  return ev.type === "result";
}

/** Per-session configuration handed to a backend when a session opens. */
export interface AgentSessionContext {
  room: string;
  channel: string;
  systemPrompt: string;
  cwd: string;
  model?: string;
  /**
   * MCP wiring. There are two real call paths in the codebase and the adapter
   * uses whichever is present (it must NOT rebuild this itself, or chat loses
   * its Slack thread context):
   *  - chat passes a pre-built server blob down via `EngineOptions.mcpServers`
   *    (built by the channel through `getMcpServers(slackCtx)`);
   *  - jobs pass a raw `McpSourceContext` and let the backend wire MCP.
   */
  mcpServers?: Record<string, unknown>;
  source?: McpSourceContext;
  resume: boolean | string;
  /** Capability-gated; consumed only by backends that support subagents (Claude). */
  subagents?: Record<string, AgentDef>;
}

/** Per-turn input. */
export interface TurnInput {
  text: string;
  attachments?: Attachment[];
}

/**
 * A live agent session. Chat keeps one open across many turns; a job opens it,
 * sends once, and closes.
 */
export interface AgentSession {
  /**
   * Re-read AFTER each `send()` drains: a new session assigns it on the first
   * turn, and an internal retry may rotate it. The consumer threads this value
   * into finalizer/DB — it must never cache the id from before the send.
   */
  readonly backendSessionId: string | null;
  /** Streams the turn's events; ends with `result` or `error`. Emits exactly one
   *  `session` event even across internal retries. */
  send(text: string, attachments?: Attachment[]): AsyncIterable<AgentEvent>;
  /** Interrupt an in-flight send. Retry teardown+restart is atomic w.r.t. this.
   *  The consumer registers it via `registerActiveHandle`. */
  abort(reason: string): void;
  close(): Promise<void>;
}

export interface AgentBackend {
  readonly name: "claude" | "codex" | "gemini";
  openSession(ctx: AgentSessionContext): Promise<AgentSession>;
  /** Whether a prior session id can be resumed on this backend in this cwd.
   *  Opaque to the consumer — Claude probes a jsonl file, Codex a thread id, etc.
   *  Unknowns return false → fresh session with replayed context. */
  canResume(backendSessionId: string, cwd: string): Promise<boolean>;
}

/**
 * Shared contract for the per-backend stream normalizers. Each backend has one
 * (SdkNormalizer, CodexNormalizer, GeminiNormalizer). Normalizers are PURE — no
 * I/O, no timers — so the session is just orchestration.
 */
export interface Normalizer {
  consume(message: unknown): AgentEvent[];
}
