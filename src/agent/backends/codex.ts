import type { AgentBackend, AgentSession, AgentSessionContext, AgentEvent } from "../types";
import type { Attachment } from "../../types/attachment";
import type { McpSourceContext } from "../../mcp";
import { CodexNormalizer } from "./codex-normalize";
import { mintRun, revokeRun } from "../mcp-endpoint";

/** Minimal spawned-process surface, injectable so the session is unit-testable. */
export interface CliProc {
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array>;
  exited: Promise<number>;
  kill(): void;
}
export type SpawnFn = (args: string[], opts: { cwd: string; env: Record<string, string> }) => CliProc;

// Nia secrets that must never reach a third-party agent subprocess. Codex
// authenticates via its own ~/.codex login, not these.
const SCRUB = new Set([
  "ANTHROPIC_API_KEY",
  "SLACK_BOT_TOKEN",
  "SLACK_APP_TOKEN",
  "TELEGRAM_BOT_TOKEN",
  "TWILIO_AUTH_TOKEN",
  "DATABASE_URL",
]);

function scrubbedEnv(extra: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (!SCRUB.has(k) && v != null) env[k] = v;
  }
  return { ...env, ...extra };
}

function defaultSpawn(args: string[], opts: { cwd: string; env: Record<string, string> }): CliProc {
  const proc = Bun.spawn(["codex", ...args], { cwd: opts.cwd, env: opts.env, stdout: "pipe", stderr: "pipe" });
  return {
    stdout: proc.stdout as ReadableStream<Uint8Array>,
    stderr: proc.stderr as ReadableStream<Uint8Array>,
    exited: proc.exited,
    kill: () => proc.kill(),
  };
}

async function* readLines(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf("\n")) >= 0) {
      yield buf.slice(0, idx);
      buf = buf.slice(idx + 1);
    }
  }
  if (buf.trim()) yield buf;
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
  let out = "";
  const decoder = new TextDecoder();
  const reader = stream.getReader();
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  return out;
}

export class CodexBackend implements AgentBackend {
  readonly name = "codex" as const;
  private spawnFn: SpawnFn;

  constructor(deps?: { spawnFn?: SpawnFn }) {
    this.spawnFn = deps?.spawnFn ?? defaultSpawn;
  }

  async openSession(ctx: AgentSessionContext): Promise<AgentSession> {
    return new CodexSession(ctx, this.spawnFn);
  }

  async canResume(): Promise<boolean> {
    // v1: no thread resume; failover/continuity replays history from Nia's DB.
    return false;
  }
}

class CodexSession implements AgentSession {
  private _sessionId: string | null = null;
  private aborted: string | null = null;
  private proc: CliProc | null = null;

  constructor(
    private ctx: AgentSessionContext,
    private spawnFn: SpawnFn,
  ) {}

  get backendSessionId(): string | null {
    return this._sessionId;
  }

  async *send(text: string, _attachments?: Attachment[]): AsyncIterable<AgentEvent> {
    const source: McpSourceContext = this.ctx.source ?? { channel: this.ctx.channel, room: this.ctx.room };
    const { url, token } = await mintRun(source);

    const fullPrompt = `${this.ctx.systemPrompt}\n\n---\n\n${text}`;
    const args = [
      "exec",
      fullPrompt,
      "--json",
      "--skip-git-repo-check",
      "--dangerously-bypass-approvals-and-sandbox",
      "-C",
      this.ctx.cwd,
      "-c",
      `mcp_servers.nia.url="${url}"`,
      "-c",
      `mcp_servers.nia.bearer_token_env_var="NIA_MCP_TOKEN"`,
    ];
    if (this.ctx.model && this.ctx.model !== "default") args.push("-m", this.ctx.model);

    const proc = this.spawnFn(args, { cwd: this.ctx.cwd, env: scrubbedEnv({ NIA_MCP_TOKEN: token }) });
    this.proc = proc;

    const normalizer = new CodexNormalizer();
    let sawResult = false;
    try {
      for await (const line of readLines(proc.stdout)) {
        if (this.aborted) throw new Error(this.aborted);
        const trimmed = line.trim();
        if (!trimmed) continue;
        let parsed: unknown;
        try {
          parsed = JSON.parse(trimmed);
        } catch {
          continue;
        }
        for (const ev of normalizer.consume(parsed)) {
          if (ev.type === "session" || ev.type === "result") {
            this._sessionId = ev.backendSessionId || this._sessionId;
          }
          if (ev.type === "result") sawResult = true;
          yield ev;
        }
      }
      const exit = await proc.exited;
      if (this.aborted) throw new Error(this.aborted);
      if (exit !== 0 && !sawResult) {
        const stderr = await readAll(proc.stderr);
        yield {
          type: "error",
          message: stderr.trim() || `codex exited ${exit}`,
          retryable: false,
          providerDown: false,
        };
      }
    } finally {
      revokeRun(token);
      this.proc = null;
    }
  }

  abort(reason: string): void {
    this.aborted = reason;
    this.proc?.kill();
  }

  async close(): Promise<void> {
    // codex exec is one-shot per send; nothing persistent to tear down.
  }
}
