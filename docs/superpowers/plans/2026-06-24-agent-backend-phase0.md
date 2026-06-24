# AgentBackend Phase 0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce the `AgentBackend`/`AgentSession` seam plus the Claude `SdkBackend`, and route both the chat engine and the job runner through it with zero behavior change — so Phase 1 can add a Codex/ACP backend behind the same interface.

**Architecture:** A session-shaped backend interface (a job is a one-send session; chat is a many-send session). A pure `SdkNormalizer` turns Claude Agent SDK messages into a small normalized `AgentEvent` vocabulary — unifying logic currently duplicated between `engine.ts` and `runner.ts`. `SdkBackend` wraps `query()` + the warm `MessageStream` + the retry loop behind `AgentSession`. The engine and runner become thin consumers of `AgentEvent`. Claude-only; no new runtime deps.

**Tech Stack:** TypeScript, Bun (`bun:test`), `@anthropic-ai/claude-agent-sdk`.

## Global Constraints

- **Zero behavior change.** Claude chat + jobs behave identically to today. The existing suites (`tests/chat/engine.test.ts`, `tests/chat/engine.integration.test.ts`, `tests/core/runner.test.ts`) must stay green.
- **No new runtime dependencies.** Phase 0 is internal refactor only. No ACP packages.
- **No backwards-compat shims.** Migrate call sites by hand (project convention); do not leave dead `runJobWithClaude`/`runJobWithCodex` exports "just in case."
- **Test command:** `LOG_LEVEL=silent bun test <path>` for a file; `bun run test` runs the full gate (`tsc --noEmit && check:cycles && bun test`).
- **Files stay focused.** New code lives under `src/agent/`. Do not expand the `AgentEvent` union beyond the vocabulary defined in Task 1.
- **No `if (backend === …)` branching** in any consumer — consumers switch on `AgentEvent.kind`, never on backend identity.

---

### Task 1: Normalized event vocabulary + backend interfaces

**Files:**

- Create: `src/agent/events.ts`
- Create: `src/agent/backend.ts`
- Test: `tests/agent/events.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `AgentEvent`, `ToolStatus`, `ResultCost` (from `events.ts`); `AgentBackend`, `AgentSession`, `SessionContext`, `TurnInput`, `BackendCapabilities` (from `backend.ts`). Later tasks import these exact names.

- [ ] **Step 1: Write the failing test**

`tests/agent/events.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import type { AgentEvent, ResultCost } from "../../src/agent/events";
import { isResultEvent } from "../../src/agent/events";

describe("AgentEvent", () => {
  test("isResultEvent narrows a result event", () => {
    const ev: AgentEvent = {
      kind: "result",
      text: "done",
      cost: { kind: "dollars", usd: 0.01, turns: 1 } as ResultCost,
    };
    expect(isResultEvent(ev)).toBe(true);
    if (isResultEvent(ev)) expect(ev.text).toBe("done");
  });

  test("isResultEvent rejects a text event", () => {
    const ev: AgentEvent = { kind: "text", delta: "hi", cumulative: "hi" };
    expect(isResultEvent(ev)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `LOG_LEVEL=silent bun test tests/agent/events.test.ts`
Expected: FAIL — cannot resolve `../../src/agent/events`.

- [ ] **Step 3: Create `src/agent/events.ts`**

```ts
/** Status of a tool call, mirrored from ACP's tool_call status enum. */
export type ToolStatus = "pending" | "in_progress" | "completed" | "failed";

/** Cost of a turn. A union so a tokens-only backend (Codex) is first-class. */
export type ResultCost =
  | { kind: "dollars"; usd: number; turns: number; usage?: unknown }
  | { kind: "tokens"; input: number; output: number };

/**
 * Normalized agent event vocabulary. ACP-mirrored, intentionally minimal —
 * every backend maps its native stream into exactly these kinds.
 *
 * - `text`: streamed reply (-> onStream). `cumulative` is the full text so far.
 * - `thinking` / `progress`: status lines (-> onActivity).
 * - `tool`: structured tool-call status (populated by ACP backends; SdkBackend
 *   emits tool activity as `progress` lines to preserve current behavior).
 * - `result` / `error`: terminal events ending a turn.
 */
export type AgentEvent =
  | { kind: "session"; sessionId: string }
  | { kind: "text"; delta: string; cumulative: string }
  | { kind: "thinking"; line: string }
  | { kind: "tool"; id: string; name: string; status: ToolStatus }
  | { kind: "progress"; line: string }
  | {
      kind: "result";
      text: string;
      cost: ResultCost;
      stopReason?: string;
      /** Backend-native metadata persisted to the DB by the consumer. */
      metadata?: Record<string, unknown>;
    }
  | { kind: "error"; message: string; retryable: boolean };

export function isResultEvent(ev: AgentEvent): ev is Extract<AgentEvent, { kind: "result" }> {
  return ev.kind === "result";
}
```

- [ ] **Step 4: Create `src/agent/backend.ts`**

```ts
import type { AgentEvent } from "./events";
import type { Attachment } from "../types/attachment";

/** Subagent definition passed through to backends that support delegation. */
export interface AgentDef {
  description: string;
  prompt: string;
  model?: string;
}

export interface BackendCapabilities {
  /** Backend streams text deltas incrementally. */
  streamingText: boolean;
  /** Backend streams reasoning incrementally; if false the gap is synthesized. */
  streamingThinking: boolean;
  /** Backend can resume a prior session by id (capability-gated per backend). */
  sessionResume: boolean;
  /** Backend reports dollar cost (vs token counts only). */
  dollarCost: boolean;
}

/** Per-session configuration. Fixed for the life of the session. */
export interface SessionContext {
  systemPrompt: string;
  cwd: string;
  /** Resolved to the active backend's model namespace before the session opens. */
  model?: string;
  /** Resume a prior session by id, or null/undefined for a fresh session. */
  resume?: { sessionId: string } | null;
  /** MCP servers to expose to the agent (backend-specific shape, opaque here). */
  mcpServers?: Record<string, unknown>;
  /** Subagent definitions; capability-gated (SdkBackend only). */
  subagents?: Record<string, AgentDef>;
  /** Tracking room for ActiveEngine/abort registration. */
  room: string;
  /** Channel label, used in persisted metadata. */
  channel: string;
}

/** Per-turn input. */
export interface TurnInput {
  userText: string;
  attachments?: Attachment[];
  signal?: AbortSignal;
}

/**
 * A live agent session. Chat keeps one open across many turns; a job opens it,
 * sends once, and closes. `send` streams normalized events and ends each turn
 * with a `result` or `error` event.
 */
export interface AgentSession {
  /** Known after the first turn's `session` event; null before then. */
  readonly sessionId: string | null;
  send(turn: TurnInput): AsyncIterable<AgentEvent>;
  /** Out-of-band cancel; normalizes to a terminal event with stopReason "aborted". */
  cancel(reason: string): void;
  close(): Promise<void>;
}

export interface AgentBackend {
  readonly id: "claude-sdk" | "codex-acp" | string;
  readonly capabilities: BackendCapabilities;
  startSession(ctx: SessionContext): AgentSession;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `LOG_LEVEL=silent bun test tests/agent/events.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add src/agent/events.ts src/agent/backend.ts tests/agent/events.test.ts
git commit -m "feat(agent): add AgentEvent vocabulary and AgentBackend interfaces"
```

---

### Task 2: Pure `SdkNormalizer` (Claude SDK message → AgentEvent)

This extracts the SDK-event handling duplicated in `engine.ts:372–573` and `runner.ts:170–243` into one tested pure reducer. It holds the text/thinking accumulation state those loops kept as locals.

**Files:**

- Create: `src/agent/backends/sdk-normalize.ts`
- Test: `tests/agent/sdk-normalize.test.ts`

**Interfaces:**

- Consumes: `AgentEvent`, `ResultCost` (Task 1); `truncate`, `formatToolUse` from `../../utils/format-activity`.
- Produces: `class SdkNormalizer` with `consume(message: unknown): AgentEvent[]`. Later tasks (SdkSession) call `consume` per SDK message.

- [ ] **Step 1: Write the failing test**

`tests/agent/sdk-normalize.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { SdkNormalizer } from "../../src/agent/backends/sdk-normalize";

describe("SdkNormalizer", () => {
  test("init message yields a session event", () => {
    const n = new SdkNormalizer();
    expect(n.consume({ type: "system", subtype: "init", session_id: "s1" })).toEqual([
      { kind: "session", sessionId: "s1" },
    ]);
  });

  test("text_delta yields text with accumulating cumulative", () => {
    const n = new SdkNormalizer();
    const a = n.consume({
      type: "stream_event",
      event: { type: "content_block_delta", delta: { type: "text_delta", text: "He" } },
    });
    const b = n.consume({
      type: "stream_event",
      event: { type: "content_block_delta", delta: { type: "text_delta", text: "llo" } },
    });
    expect(a).toEqual([{ kind: "text", delta: "He", cumulative: "He" }]);
    expect(b).toEqual([{ kind: "text", delta: "llo", cumulative: "Hello" }]);
  });

  test("thinking_delta emits a thinking line only on newline boundary", () => {
    const n = new SdkNormalizer();
    const partial = n.consume({
      type: "stream_event",
      event: { type: "content_block_delta", delta: { type: "thinking_delta", thinking: "first line" } },
    });
    expect(partial).toEqual([]); // no newline yet
    const complete = n.consume({
      type: "stream_event",
      event: { type: "content_block_delta", delta: { type: "thinking_delta", thinking: "\nsecond" } },
    });
    expect(complete).toEqual([{ kind: "thinking", line: "first line" }]);
  });

  test("tool_use_summary yields a formatted progress line", () => {
    const n = new SdkNormalizer();
    expect(n.consume({ type: "tool_use_summary", tool_name: "Read", tool_input: { file_path: "/x" } })).toEqual([
      { kind: "progress", line: expect.stringContaining("Read") },
    ]);
  });

  test("bash tool_progress yields a $-prefixed progress line", () => {
    const n = new SdkNormalizer();
    expect(n.consume({ type: "tool_progress", tool_name: "Bash", content: "ls -la" })).toEqual([
      { kind: "progress", line: "$ ls -la" },
    ]);
  });

  test("successful result yields a result event with dollar cost", () => {
    const n = new SdkNormalizer();
    const out = n.consume({
      type: "result",
      is_error: false,
      result: "answer",
      total_cost_usd: 0.02,
      num_turns: 3,
      terminal_reason: "end_turn",
      usage: { foo: 1 },
    });
    expect(out).toHaveLength(1);
    const ev = out[0]!;
    expect(ev.kind).toBe("result");
    if (ev.kind === "result") {
      expect(ev.text).toBe("answer");
      expect(ev.cost).toEqual({ kind: "dollars", usd: 0.02, turns: 3, usage: { foo: 1 } });
      expect(ev.stopReason).toBe("end_turn");
      expect(ev.metadata?.cost_usd).toBe(0.02);
    }
  });

  test("error result yields a retryable error for transient API failures", () => {
    const n = new SdkNormalizer();
    const out = n.consume({ type: "result", is_error: true, errors: ["overloaded_error"], terminal_reason: "error" });
    expect(out).toEqual([{ kind: "error", message: "overloaded_error", retryable: true }]);
  });

  test("error result yields a non-retryable error otherwise", () => {
    const n = new SdkNormalizer();
    const out = n.consume({ type: "result", is_error: true, errors: ["oauth_org_not_allowed"] });
    expect(out).toEqual([{ kind: "error", message: "oauth_org_not_allowed", retryable: false }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `LOG_LEVEL=silent bun test tests/agent/sdk-normalize.test.ts`
Expected: FAIL — cannot resolve `sdk-normalize`.

- [ ] **Step 3: Create `src/agent/backends/sdk-normalize.ts`**

```ts
import type { AgentEvent } from "../events";
import { truncate, formatToolUse } from "../../utils/format-activity";
import { isRetryableApiError } from "../../utils/retry";

/**
 * Stateful reducer: Claude Agent SDK messages -> normalized AgentEvents.
 * Holds the text/thinking accumulation the old engine/runner loops kept inline.
 * Display strings (truncation, formatToolUse, "$ " prefix) are produced here so
 * consumers stay backend-agnostic and behavior is preserved exactly.
 */
export class SdkNormalizer {
  private accumulatedText = "";
  private accumulatedThinking = "";
  private lastThinkingLine = "";

  consume(message: unknown): AgentEvent[] {
    const msg = message as any;
    const out: AgentEvent[] = [];

    if (msg.type === "system" && msg.subtype === "init") {
      out.push({ kind: "session", sessionId: msg.session_id });
      return out;
    }

    if (msg.type === "stream_event") {
      const event = msg.event;
      if (event?.type === "content_block_delta") {
        const delta = event.delta;
        if (delta?.type === "text_delta" && delta.text) {
          this.accumulatedText += delta.text;
          out.push({ kind: "text", delta: delta.text, cumulative: this.accumulatedText });
        }
        if (delta?.type === "thinking_delta" && delta.thinking) {
          this.accumulatedThinking += delta.thinking;
          const lines = this.accumulatedThinking.split("\n");
          if (lines.length > 1) {
            const completeLine = lines[lines.length - 2]?.trim();
            if (completeLine && completeLine !== this.lastThinkingLine) {
              this.lastThinkingLine = completeLine;
              out.push({ kind: "thinking", line: truncate(completeLine, 70) });
            }
          }
        }
      }
      if (event?.type === "content_block_start" && event.content_block?.type === "thinking") {
        this.accumulatedThinking = "";
        this.lastThinkingLine = "";
        out.push({ kind: "thinking", line: "thinking..." });
      }
      if (event?.type === "content_block_stop") {
        this.accumulatedThinking = "";
        this.lastThinkingLine = "";
      }
      return out;
    }

    if (msg.type === "tool_use_summary") {
      out.push({ kind: "progress", line: formatToolUse(msg.tool_name || "tool", msg.tool_input) });
      return out;
    }

    if (msg.type === "tool_progress") {
      if (msg.tool_name === "Bash" && msg.content) {
        out.push({ kind: "progress", line: `$ ${truncate(msg.content, 60)}` });
      } else if (msg.content) {
        out.push({ kind: "progress", line: truncate(msg.content, 70) });
      }
      return out;
    }

    if (msg.type === "system") {
      if (msg.subtype === "task_started" && msg.description) {
        out.push({ kind: "progress", line: truncate(msg.description, 60) });
      }
      if (msg.subtype === "task_progress" && msg.last_tool_name) {
        out.push({ kind: "progress", line: msg.summary || msg.last_tool_name });
      }
      return out;
    }

    if (msg.type === "result") {
      if (!msg.is_error) {
        out.push({
          kind: "result",
          text: (msg.result as string) || "",
          cost: { kind: "dollars", usd: msg.total_cost_usd ?? 0, turns: msg.num_turns ?? 0, usage: msg.usage },
          stopReason: msg.terminal_reason,
          metadata: {
            cost_usd: msg.total_cost_usd,
            turns: msg.num_turns,
            duration_ms: msg.duration_ms,
            duration_api_ms: msg.duration_api_ms,
            stop_reason: msg.stop_reason,
            terminal_reason: msg.terminal_reason,
            session_id: msg.session_id,
            subtype: msg.subtype,
            usage: msg.usage,
            model_usage: msg.modelUsage,
          },
        });
      } else {
        const rawError = msg.errors?.join(", ") || "unknown error";
        out.push({ kind: "error", message: rawError, retryable: isRetryableApiError(rawError) });
      }
      return out;
    }

    return out;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `LOG_LEVEL=silent bun test tests/agent/sdk-normalize.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/agent/backends/sdk-normalize.ts tests/agent/sdk-normalize.test.ts
git commit -m "feat(agent): add pure SdkNormalizer for SDK message -> AgentEvent"
```

---

### Task 3: `SdkBackend` / `SdkSession` over an injectable `query`

Wraps `query()` + the warm `MessageStream` + the retry loop behind `AgentSession`, emitting `AgentEvent`s from `SdkNormalizer`. The `query` function is injected so tests drive it with a fake async iterable of SDK messages (no live Claude).

**Files:**

- Create: `src/agent/backends/sdk.ts`
- Create: `src/agent/message-stream.ts` (move `MessageStream` + `buildContentBlocks` out of `engine.ts`)
- Test: `tests/agent/sdk-backend.test.ts`

**Interfaces:**

- Consumes: `AgentBackend`, `AgentSession`, `SessionContext`, `TurnInput` (Task 1); `SdkNormalizer` (Task 2); `query` type from `@anthropic-ai/claude-agent-sdk`.
- Produces: `class SdkBackend implements AgentBackend` with constructor `new SdkBackend(deps?: { queryFn?: QueryFn })`; `type QueryFn = (args: { prompt: unknown; options: unknown }) => AsyncIterable<unknown> & { close(): void }`. Exports `MessageStream`, `buildContentBlocks` from `message-stream.ts`.

- [ ] **Step 1: Move `MessageStream` + `buildContentBlocks` into `src/agent/message-stream.ts`**

Cut `MessageStream` (`engine.ts:127–159`), the `SDKUserMessage` interface (`engine.ts:38–43`), and `buildContentBlocks` (`engine.ts:46–99`) verbatim into a new `src/agent/message-stream.ts`, exporting all three. In `engine.ts`, replace the removed code with `import { MessageStream, buildContentBlocks } from "../agent/message-stream";` and keep the `buildContentBlocks` re-export (`tests/chat/engine.test.ts` imports it from `../../src/chat/engine`) by adding `export { buildContentBlocks } from "../agent/message-stream";` to `engine.ts`.

- [ ] **Step 2: Run the existing engine tests to confirm the move is behavior-neutral**

Run: `LOG_LEVEL=silent bun test tests/chat/engine.test.ts`
Expected: PASS (unchanged from before the move).

- [ ] **Step 3: Write the failing test**

`tests/agent/sdk-backend.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { SdkBackend } from "../../src/agent/backends/sdk";
import type { AgentEvent } from "../../src/agent/events";

// Fake query: yields the scripted SDK messages, then ends.
function fakeQuery(messages: unknown[]) {
  return (_args: { prompt: unknown; options: unknown }) => {
    const iter = (async function* () {
      for (const m of messages) yield m;
    })();
    return Object.assign(iter, { close() {} });
  };
}

async function collect(stream: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const ev of stream) out.push(ev);
  return out;
}

describe("SdkSession", () => {
  test("send streams normalized events ending in a result", async () => {
    const backend = new SdkBackend({
      queryFn: fakeQuery([
        { type: "system", subtype: "init", session_id: "s1" },
        { type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "hi" } } },
        {
          type: "result",
          is_error: false,
          result: "hi",
          total_cost_usd: 0.01,
          num_turns: 1,
          terminal_reason: "end_turn",
        },
      ]),
    });
    const session = backend.startSession({ systemPrompt: "sys", cwd: "/tmp", room: "r", channel: "test" });
    const events = await collect(session.send({ userText: "hello" }));

    expect(events.map((e) => e.kind)).toEqual(["session", "text", "result"]);
    expect(session.sessionId).toBe("s1");
    const result = events.at(-1)!;
    if (result.kind === "result") expect(result.text).toBe("hi");
    await session.close();
  });

  test("send retries once on a transient error then succeeds", async () => {
    let call = 0;
    const backend = new SdkBackend({
      queryFn: (_args) => {
        call++;
        const messages =
          call === 1
            ? [{ type: "result", is_error: true, errors: ["overloaded_error"], terminal_reason: "error" }]
            : [{ type: "result", is_error: false, result: "ok", total_cost_usd: 0, num_turns: 1 }];
        const iter = (async function* () {
          for (const m of messages) yield m;
        })();
        return Object.assign(iter, { close() {} });
      },
    });
    const session = backend.startSession({
      systemPrompt: "s",
      cwd: "/tmp",
      room: "r",
      channel: "test",
      retryDelaysMs: [0, 0],
    } as any);
    const events = await collect(session.send({ userText: "go" }));
    const last = events.at(-1)!;
    expect(last.kind).toBe("result");
    if (last.kind === "result") expect(last.text).toBe("ok");
    expect(call).toBe(2);
    await session.close();
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `LOG_LEVEL=silent bun test tests/agent/sdk-backend.test.ts`
Expected: FAIL — cannot resolve `sdk`.

- [ ] **Step 5: Create `src/agent/backends/sdk.ts`**

```ts
import { query } from "@anthropic-ai/claude-agent-sdk";
import { randomUUID } from "crypto";
import type { AgentBackend, AgentSession, BackendCapabilities, SessionContext, TurnInput } from "../backend";
import type { AgentEvent } from "../events";
import { SdkNormalizer } from "./sdk-normalize";
import { MessageStream } from "../message-stream";
import { getSdkSkillsSetting } from "../../core/skills";
import { getSdkHooks } from "../../core/sdk-hooks";
import { sleep } from "../../utils/retry";

export type QueryHandle = AsyncIterable<unknown> & { close(): void };
export type QueryFn = (args: { prompt: unknown; options: unknown }) => QueryHandle;

const DEFAULT_RETRY_DELAYS = [3_000, 8_000];
const MAX_RETRIES = 2;

const CAPABILITIES: BackendCapabilities = {
  streamingText: true,
  streamingThinking: true,
  sessionResume: true,
  dollarCost: true,
};

export class SdkBackend implements AgentBackend {
  readonly id = "claude-sdk";
  readonly capabilities = CAPABILITIES;
  private queryFn: QueryFn;

  constructor(deps?: { queryFn?: QueryFn }) {
    this.queryFn = deps?.queryFn ?? (query as unknown as QueryFn);
  }

  startSession(ctx: SessionContext): AgentSession {
    return new SdkSession(ctx, this.queryFn);
  }
}

class SdkSession implements AgentSession {
  private _sessionId: string | null;
  private handle: QueryHandle | null = null;
  private stream: MessageStream | null = null;
  private aborted: string | null = null;
  private readonly retryDelays: number[];

  constructor(
    private ctx: SessionContext & { retryDelaysMs?: number[] },
    private queryFn: QueryFn,
  ) {
    this._sessionId = ctx.resume?.sessionId ?? null;
    this.retryDelays = ctx.retryDelaysMs ?? DEFAULT_RETRY_DELAYS;
  }

  get sessionId(): string | null {
    return this._sessionId;
  }

  private startQuery(): void {
    this.stream = new MessageStream();
    const options: Record<string, unknown> = {
      systemPrompt: this.ctx.systemPrompt,
      cwd: this.ctx.cwd,
      permissionMode: "bypassPermissions",
      includePartialMessages: true,
      settingSources: ["project", "user"],
      skills: getSdkSkillsSetting(),
      hooks: getSdkHooks(),
    };
    if (this.ctx.model && this.ctx.model !== "default") options.model = this.ctx.model;
    if (this._sessionId) {
      options.resume = this._sessionId;
    } else {
      options.continue = false;
      options.sessionId = randomUUID();
    }
    if (this.ctx.mcpServers) options.mcpServers = this.ctx.mcpServers;
    if (this.ctx.subagents && Object.keys(this.ctx.subagents).length > 0) options.agents = this.ctx.subagents;
    this.handle = this.queryFn({ prompt: this.stream as unknown, options });
  }

  async *send(turn: TurnInput): AsyncIterable<AgentEvent> {
    let attempt = 0;
    while (true) {
      if (!this.handle || !this.stream) this.startQuery();
      const normalizer = new SdkNormalizer();
      this.stream!.push(turn.userText, turn.attachments);

      let retried = false;
      for await (const message of this.handle!) {
        if (this.aborted) {
          const reason = this.aborted;
          yield {
            kind: "result",
            text: "",
            cost: { kind: "dollars", usd: 0, turns: 0 },
            stopReason: "aborted",
            metadata: { error: reason },
          };
          return;
        }
        for (const ev of normalizer.consume(message)) {
          if (ev.kind === "session") this._sessionId = ev.sessionId;
          if (ev.kind === "error" && ev.retryable && attempt < MAX_RETRIES) {
            attempt++;
            await this.teardown();
            await sleep(this.retryDelays[attempt - 1] ?? 8_000);
            retried = true;
            break;
          }
          yield ev;
          if (ev.kind === "result" || (ev.kind === "error" && !ev.retryable)) return;
        }
        if (retried) break;
      }
      if (!retried) return; // stream ended (with or without result — caller handles absence)
    }
  }

  cancel(reason: string): void {
    this.aborted = reason;
    this.handle?.close();
  }

  private async teardown(): Promise<void> {
    this.stream?.end();
    this.handle?.close();
    this.stream = null;
    this.handle = null;
  }

  async close(): Promise<void> {
    await this.teardown();
  }
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `LOG_LEVEL=silent bun test tests/agent/sdk-backend.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 7: Commit**

```bash
git add src/agent/backends/sdk.ts src/agent/message-stream.ts src/chat/engine.ts tests/agent/sdk-backend.test.ts
git commit -m "feat(agent): add SdkBackend/SdkSession wrapping query() behind AgentSession"
```

---

### Task 4: `getBackend` selector

**Files:**

- Create: `src/agent/index.ts`
- Test: `tests/agent/index.test.ts`

**Interfaces:**

- Consumes: `AgentBackend` (Task 1), `SdkBackend` (Task 3).
- Produces: `getBackend(role?: string): AgentBackend`. Phase 0 always returns a shared `SdkBackend`. Phase 1 extends this to read config + return `AcpBackend`.

- [ ] **Step 1: Write the failing test**

`tests/agent/index.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { getBackend } from "../../src/agent";

describe("getBackend", () => {
  test("returns the claude-sdk backend by default", () => {
    expect(getBackend().id).toBe("claude-sdk");
  });
  test("returns a stable singleton", () => {
    expect(getBackend()).toBe(getBackend());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `LOG_LEVEL=silent bun test tests/agent/index.test.ts`
Expected: FAIL — cannot resolve `../../src/agent`.

- [ ] **Step 3: Create `src/agent/index.ts`**

```ts
import type { AgentBackend } from "./backend";
import { SdkBackend } from "./backends/sdk";

export type { AgentBackend, AgentSession, SessionContext, TurnInput, BackendCapabilities } from "./backend";
export type { AgentEvent, ResultCost, ToolStatus } from "./events";
export { isResultEvent } from "./events";

let sdkBackend: AgentBackend | null = null;

/**
 * Resolve the backend for a role. Phase 0: always the Claude SDK backend.
 * Phase 1: reads config (backends map + role selector) and may return AcpBackend.
 */
export function getBackend(_role?: string): AgentBackend {
  if (!sdkBackend) sdkBackend = new SdkBackend();
  return sdkBackend;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `LOG_LEVEL=silent bun test tests/agent/index.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/agent/index.ts tests/agent/index.test.ts
git commit -m "feat(agent): add getBackend selector (SdkBackend for Phase 0)"
```

---

### Task 5: Migrate `runJobWithClaude` to consume `SdkSession`

The one-shot consumer — migrated first because it has no warm reuse or idle timers. Behavior gate: `tests/core/runner.test.ts` stays green.

**Files:**

- Modify: `src/core/runner.ts:112–270` (`runJobWithClaude`)
- Test: `tests/core/runner.test.ts` (existing; add one characterization test)

**Interfaces:**

- Consumes: `getBackend` (Task 4); `AgentEvent`, `SessionContext`, `TurnInput`.
- Produces: `runJobWithClaude(...)` keeps its exact signature and `RunnerOutput` return shape (`{ agentText, sessionId, terminalReason?, error? }`).

- [ ] **Step 1: Add a characterization test for the abort path**

Append to `tests/core/runner.test.ts` inside the existing `describe`:

```ts
test("runJobWithClaude returns aborted output when cancelled", async () => {
  const { runJobWithClaude } = await import("../../src/core/runner");
  const { registerActiveHandle } = await import("../../src/core/active-handles");
  // Trigger abort as soon as the handle registers.
  queueMicrotask(() => {
    const handlers = (globalThis as any).__activeHandles;
    void handlers; // abort is driven via the room handle below
  });
  // Use a room and abort it mid-run via the active-handles registry.
  const room = "_test/abort";
  const p = runJobWithClaude("sys", "prompt", "/tmp", undefined, undefined, undefined, room);
  // Give the handle a tick to register, then abort.
  await new Promise((r) => setTimeout(r, 10));
  const { closeAllActiveHandles } = await import("../../src/core/active-handles");
  await closeAllActiveHandles("test abort");
  const out = await p;
  expect(out.terminalReason).toBe("aborted");
});
```

(If `closeAllActiveHandles` has a different name, check `src/core/active-handles.ts` and use the real export — this test only asserts the aborted `terminalReason` contract is preserved.)

- [ ] **Step 2: Run the existing runner suite to capture the green baseline**

Run: `LOG_LEVEL=silent bun test tests/core/runner.test.ts`
Expected: PASS for all existing tests; the new abort test may FAIL until Step 3 if the current code path differs — that is acceptable as the failing test for this task.

- [ ] **Step 3: Rewrite `runJobWithClaude` to drive `SdkSession`**

Replace the body of `runJobWithClaude` (`runner.ts:112–270`) with:

```ts
export async function runJobWithClaude(
  systemPrompt: string,
  jobPrompt: string,
  cwd: string,
  onActivity?: ActivityCallback,
  model?: string,
  sourceCtx?: McpSourceContext,
  activeRoom?: string,
): Promise<RunnerOutput> {
  const mcpServers = getMcpServers(sourceCtx) ?? undefined;
  const session = getBackend().startSession({
    systemPrompt,
    cwd,
    model,
    mcpServers,
    room: activeRoom ?? `_oneshot/${randomUUID()}`,
    channel: "system",
  });

  if (activeRoom) {
    registerActiveHandle(activeRoom, (reason) => session.cancel(reason));
  }

  let agentText = "";
  let terminalReason: string | undefined;
  let error: string | undefined;

  try {
    for await (const ev of session.send({ userText: jobPrompt })) {
      if (ev.kind === "thinking" || ev.kind === "progress") onActivity?.(ev.line);
      if (ev.kind === "result") {
        agentText = ev.text;
        terminalReason = ev.stopReason;
      }
      if (ev.kind === "error") {
        terminalReason = (ev as any).stopReason;
        error = ev.message;
      }
    }
  } finally {
    await session.close();
    if (activeRoom) unregisterActiveHandle(activeRoom);
  }

  return { agentText, sessionId: session.sessionId ?? "", terminalReason, error };
}
```

Add `import { getBackend } from "../agent";` at the top. Remove the now-unused `query` import only if no other function in the file still uses it (`runJobWithCodex` does not use `query`; confirm before deleting the import).

- [ ] **Step 4: Run the runner suite to verify behavior is preserved**

Run: `LOG_LEVEL=silent bun test tests/core/runner.test.ts`
Expected: PASS (existing tests + the abort test).

- [ ] **Step 5: Commit**

```bash
git add src/core/runner.ts tests/core/runner.test.ts
git commit -m "refactor(runner): drive runJobWithClaude through SdkSession"
```

---

### Task 6: Migrate `createChatEngine` to consume `SdkSession`

The warm, multi-turn consumer. The engine keeps owning session lifecycle (idle/long-running timers, finalizer, `ActiveEngine`, DB saves, resume probe); it delegates execution + normalization + retry to `SdkSession`. Behavior gate: `tests/chat/engine.test.ts` and `tests/chat/engine.integration.test.ts` stay green.

**Files:**

- Modify: `src/chat/engine.ts` (replace `startQuery` + the inline consume loop `engine.ts:329–601`; rewrite `send` `engine.ts:612–658`)
- Test: `tests/chat/engine.test.ts`, `tests/chat/engine.integration.test.ts` (existing)

**Interfaces:**

- Consumes: `getBackend` (Task 4); `AgentEvent`, `SessionContext`, `TurnInput`. Keeps `ChatEngine`/`SendResult`/`EngineOptions` from `../types` unchanged.
- Produces: `createChatEngine(opts)` returns the same `ChatEngine` shape (`sessionId`, `room`, `send`, `close`).

- [ ] **Step 1: Run the existing engine suites to capture the green baseline**

Run: `LOG_LEVEL=silent bun test tests/chat/engine.test.ts tests/chat/engine.integration.test.ts`
Expected: PASS. Record the count — it must not drop after the rewrite.

- [ ] **Step 2: Replace `startQuery` + the inline loop with a session and an event-driven `send`**

In `createChatEngine`, after the resume/`sessionFileExists` block, replace the engine-local query plumbing (`startQuery`, the `MessageStream`/`queryHandle`/`pending` consume loop) with a lazily-opened `AgentSession`:

```ts
import { getBackend } from "../agent";
import type { AgentSession } from "../agent";

// ...inside createChatEngine, replacing startQuery and the consume loop:
let session: AgentSession | null = null;

function openSession(): AgentSession {
  return getBackend().startSession({
    systemPrompt,
    cwd,
    model: resolveSdkModel(contextModel),
    resume: sessionId ? { sessionId } : null,
    mcpServers,
    subagents: Object.keys(getAgentDefinitions()).length > 0 ? getAgentDefinitions() : undefined,
    room,
    channel,
  });
}
```

Keep `idleTimer`/`longRunningTimer`/`teardown`/`abortActiveQuery`/`resetIdleTimer` — but `teardown` now calls `session?.close()` and `registerActiveHandle(room, (reason) => session?.cancel(reason))` replaces the SDK-handle abort. The `MessageStream`/`queryHandle` locals are removed (the session owns them).

- [ ] **Step 3: Rewrite `send` to consume the event stream**

Replace the `send` method body (`engine.ts:612–658`) with:

```ts
async send(userMessage: string, callbacks?: SendCallbacks, attachments?: Attachment[]) {
  clearIdleTimer();
  startLongRunningTimer();
  if (sessionId) cancelPending(sessionId).catch(() => {});
  await ActiveEngine.register(room, channel);
  if (!session) {
    session = openSession();
    registerActiveHandle(room, (reason) => session?.cancel(reason));
  }

  // Persist user message for resumed sessions; for new sessions the first
  // `session` event below assigns sessionId and we persist then.
  let userSaved = false;
  if (sessionId) {
    await Message.save({ sessionId, room, sender: "user", content: userMessage, isFromAgent: false });
    await Session.touch(sessionId);
    userSaved = true;
    messageCount++;
  }

  let accumulated = "";
  let result: SendResult = { result: "", costUsd: 0, turns: 0 };
  try {
    for await (const ev of session.send({ userText: userMessage, attachments })) {
      if (ev.kind === "session") {
        if (!sessionId || ev.sessionId !== sessionId) {
          sessionId = ev.sessionId;
          await Session.create(sessionId, room);
        }
        if (!userSaved) {
          await Message.save({ sessionId, room, sender: "user", content: userMessage, isFromAgent: false });
          userSaved = true;
          messageCount++;
        }
      } else if (ev.kind === "text") {
        accumulated = ev.cumulative;
        callbacks?.onStream?.(accumulated);
      } else if (ev.kind === "thinking" || ev.kind === "progress") {
        callbacks?.onActivity?.(ev.line);
      } else if (ev.kind === "result") {
        const cost = ev.cost.kind === "dollars" ? ev.cost.usd : 0;
        const turns = ev.cost.kind === "dollars" ? ev.cost.turns : 0;
        let messageId: number | undefined;
        if (sessionId && ev.text) {
          const saveParams = { sessionId, room, sender: "nia", content: ev.text, isFromAgent: true, deliveryStatus: "pending" as const, metadata: ev.metadata };
          try { messageId = await Message.save(saveParams); }
          catch { messageId = await Message.save({ ...saveParams, metadata: undefined }); }
          await Session.touch(sessionId);
          Session.accumulateMetadata(sessionId, { ...(ev.metadata ?? {}), channel }).catch(() => {});
        }
        await ActiveEngine.unregister(room);
        clearLongRunningTimer();
        result = { result: ev.text, costUsd: cost, turns, messageId };
      } else if (ev.kind === "error") {
        await ActiveEngine.unregister(room);
        clearLongRunningTimer();
        const errorText = formatChatError(ev.message);
        result = { result: errorText, costUsd: 0, turns: 0, signal: getChatErrorSignal(ev.message) };
      }
    }
  } catch (err) {
    await ActiveEngine.unregister(room).catch(() => {});
    throw err instanceof Error ? err : new Error(String(err));
  }
  resetIdleTimer();
  return result;
}
```

Retry now lives inside `SdkSession.send` (Task 3), so the engine's retry block is deleted. The `pending`/`PendingResult` machinery is removed — the event loop supersedes it.

- [ ] **Step 4: Run the engine suites to verify behavior is preserved**

Run: `LOG_LEVEL=silent bun test tests/chat/engine.test.ts tests/chat/engine.integration.test.ts`
Expected: PASS at the same count as Step 1.

- [ ] **Step 5: Run the full gate**

Run: `bun run test`
Expected: `tsc --noEmit` clean, no import cycles, all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/chat/engine.ts
git commit -m "refactor(engine): drive createChatEngine through SdkSession"
```

---

## Self-Review

**Spec coverage (Phase 0 scope):**

- `AgentBackend`/`AgentSession` session-shaped interface → Task 1. ✓
- Normalized `AgentEvent` vocabulary (ACP-mirrored, `dollars|tokens` cost union) → Task 1. ✓
- `SdkBackend` owns warm `query()` + `MessageStream` + retry → Task 3. ✓
- `getBackend` selector → Task 4. ✓
- Both consumers route through the seam (job runner + chat engine), zero behavior change → Tasks 5, 6. ✓
- Capability flags declared (`streamingText/Thinking`, `sessionResume`, `dollarCost`) → Task 3. ✓
- **Out of Phase 0 (deferred to Phase 1 plan):** `AcpBackend`, `nia mcp-serve`, the `backend` DB column + resume gating, the explicit ACP-job delivery step, `config.runner` removal, the policy gate. None are implemented here; they belong to the Phase 1 plan and are intentionally absent.

**Placeholder scan:** No TBD/TODO. The one soft spot is the Task 5 abort test, which says "use the real export if the name differs" — this is a genuine lookup an implementer must do against `src/core/active-handles.ts`, not a content gap; the asserted contract (`terminalReason === "aborted"`) is exact.

**Type consistency:** `AgentEvent`/`ResultCost`/`ToolStatus` (Task 1) are imported unchanged in Tasks 2–6. `QueryFn`/`QueryHandle` defined in Task 3 and used only there. `SessionContext`/`TurnInput` field names (`systemPrompt`, `cwd`, `model`, `resume`, `mcpServers`, `subagents`, `room`, `channel`, `userText`, `attachments`, `signal`) are consistent between Task 1 definition and Tasks 3/5/6 usage. `getBackend()` returns the same `AgentBackend` used everywhere.

**Note on `config.runner`:** Phase 0 leaves `runJob`'s `config.runner === "codex"` branch (`runner.ts:362`) and `runJobWithCodex` untouched — they keep working as today. Removing them is a Phase 1 concern (when `AcpBackend` replaces the bespoke Codex path), per the spec.
