import { query } from "@anthropic-ai/claude-agent-sdk";
import { randomUUID } from "crypto";
import { existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { AgentBackend, AgentSession, AgentSessionContext, AgentEvent } from "../types";
import type { Attachment } from "../../types/attachment";
import { SdkNormalizer } from "./claude-normalize";
import { MessageStream } from "../message-stream";
import { getSdkSkillsSetting } from "../../core/skills";
import { getSdkHooks } from "../../core/sdk-hooks";
import { getConfig } from "../../utils/config";
import { sleep } from "../../utils/retry";

/** The shape of the SDK `query()` handle the session consumes. Injected so the
 *  session is unit-testable without spawning Claude. */
export type QueryHandle = AsyncIterable<unknown> & { close(): void };
export type QueryFn = (args: { prompt: unknown; options: unknown }) => QueryHandle;

const MAX_SEND_RETRIES = 2;
const DEFAULT_RETRY_DELAYS = [3_000, 8_000];

/** The SDK persists sessions at ~/.claude/projects/<encoded-cwd>/<id>.jsonl. */
function sessionFileExists(sessionId: string, cwd: string): boolean {
  const encoded = cwd.replace(/\//g, "-");
  return existsSync(join(homedir(), ".claude", "projects", encoded, `${sessionId}.jsonl`));
}

/** Resolve a context/config model to the SDK's `model` option ("default" → unset). */
export function resolveSdkModel(model?: string | null): string | undefined {
  const m = model || getConfig().model;
  return m && m !== "default" ? m : undefined;
}

export class ClaudeBackend implements AgentBackend {
  readonly name = "claude" as const;
  private queryFn: QueryFn;

  constructor(deps?: { queryFn?: QueryFn }) {
    this.queryFn = deps?.queryFn ?? (query as unknown as QueryFn);
  }

  async openSession(ctx: AgentSessionContext): Promise<AgentSession> {
    return new ClaudeSession(ctx, this.queryFn);
  }

  async canResume(backendSessionId: string, cwd: string): Promise<boolean> {
    return sessionFileExists(backendSessionId, cwd);
  }
}

/**
 * A warm Claude session: one `query()` subprocess + `MessageStream` reused
 * across turns (the latency optimization). Each `send()` pushes a turn and
 * yields its normalized events until a terminal `result`/`error`.
 *
 * Invariants (from the plan review):
 *  - exactly ONE `session` event per `send()`, even across an internal retry
 *    (a retry resumes the same session id, so the post-retry init is swallowed);
 *  - retry teardown+restart is internal and atomic w.r.t. `abort()`.
 */
class ClaudeSession implements AgentSession {
  private _sessionId: string | null;
  private handle: QueryHandle | null = null;
  private iterator: AsyncIterator<unknown> | null = null;
  private stream: MessageStream | null = null;
  private aborted: string | null = null;
  private retryCount = 0;
  private readonly retryDelays: number[];

  constructor(
    private ctx: AgentSessionContext & { retryDelaysMs?: number[] },
    private queryFn: QueryFn,
  ) {
    this._sessionId = typeof ctx.resume === "string" ? ctx.resume : null;
    this.retryDelays = ctx.retryDelaysMs ?? DEFAULT_RETRY_DELAYS;
  }

  get backendSessionId(): string | null {
    return this._sessionId;
  }

  private startQuery(): void {
    this.stream = new MessageStream();
    const options: Record<string, unknown> = {
      systemPrompt: this.ctx.systemPrompt,
      cwd: this.ctx.cwd,
      permissionMode: "bypassPermissions",
      skills: getSdkSkillsSetting(),
      hooks: getSdkHooks(),
    };
    // Interactive (chat) sessions stream partials and load project/user settings;
    // headless one-shot jobs keep the leaner option set they had pre-refactor.
    if (this.ctx.interactive) {
      options.includePartialMessages = true;
      options.settingSources = ["project", "user"];
    }
    const model = resolveSdkModel(this.ctx.model);
    if (model) options.model = model;
    if (this._sessionId) {
      options.resume = this._sessionId;
    } else {
      options.sessionId = randomUUID();
      // Interactive sessions also forbid auto-continue of a prior session in the
      // same cwd; jobs always run with a unique id and never auto-continued.
      if (this.ctx.interactive) options.continue = false;
    }
    if (this.ctx.mcpServers) options.mcpServers = this.ctx.mcpServers;
    if (this.ctx.subagents && Object.keys(this.ctx.subagents).length > 0) options.agents = this.ctx.subagents;

    this.handle = this.queryFn({ prompt: this.stream, options });
    this.iterator = this.handle[Symbol.asyncIterator]();
  }

  async *send(text: string, attachments?: Attachment[]): AsyncIterable<AgentEvent> {
    let sawSession = false;
    while (true) {
      if (!this.iterator || !this.stream) this.startQuery();
      this.stream!.push(text, attachments);
      const normalizer = new SdkNormalizer();
      let retry = false;

      while (true) {
        let res: IteratorResult<unknown>;
        try {
          res = await this.iterator!.next();
        } catch (err) {
          if (this.aborted) throw new Error(this.aborted);
          throw err instanceof Error ? err : new Error(String(err));
        }
        if (this.aborted) throw new Error(this.aborted);
        if (res.done) {
          if (this.aborted) throw new Error(this.aborted);
          throw new Error("stream ended without result");
        }

        for (const ev of normalizer.consume(res.value)) {
          if (ev.type === "session") {
            this._sessionId = ev.backendSessionId;
            if (!sawSession) {
              sawSession = true;
              yield ev;
            }
            continue;
          }
          if (ev.type === "error" && ev.retryable && this.retryCount < MAX_SEND_RETRIES) {
            this.retryCount++;
            yield { type: "thinking", delta: "retrying after API error..." };
            await this.teardown();
            await sleep(this.retryDelays[this.retryCount - 1] ?? 8_000);
            retry = true;
            break;
          }
          yield ev;
          if (ev.type === "result" || ev.type === "error") {
            this.retryCount = 0;
            return;
          }
        }
        if (retry) break; // restart the outer loop: startQuery() resumes the same session id
      }
    }
  }

  abort(reason: string): void {
    this.aborted = reason;
    this.handle?.close();
  }

  private async teardown(): Promise<void> {
    this.stream?.end();
    this.handle?.close();
    this.stream = null;
    this.handle = null;
    this.iterator = null;
  }

  async close(): Promise<void> {
    await this.teardown();
  }
}
