import { existsSync, readdirSync } from "fs";
import { homedir } from "os";
import { join, dirname } from "path";
import type { AgentBackend, AgentSession, AgentSessionContext, AgentEvent } from "../types";
import type { Attachment } from "../../types/attachment";
import type { McpSourceContext } from "../../mcp";
import { CodexNormalizer } from "./codex-normalize";
import { mintRun, revokeRun } from "../mcp-endpoint";
import { scopeOf } from "../failure";

/**
 * Resolve the codex binary's absolute path. The daemon runs under launchd with a
 * minimal PATH (`/usr/bin:/bin:...`) that excludes nvm/homebrew bins, so a bare
 * `codex` spawn would fail. Search the likely install locations (env override,
 * the runtime's own bin, homebrew, every nvm node bin, bun) and fall back to
 * PATH only as a last resort. Cached after first resolution.
 */
let cachedCodexBin: string | null = null;
export function resolveCodexBin(): string {
  if (cachedCodexBin) return cachedCodexBin;
  const candidates: string[] = [];
  if (process.env.CODEX_PATH) candidates.push(process.env.CODEX_PATH);
  candidates.push(join(dirname(process.execPath), "codex")); // sibling of bun/node
  candidates.push("/opt/homebrew/bin/codex", "/usr/local/bin/codex");
  try {
    const nvm = join(homedir(), ".nvm", "versions", "node");
    for (const v of readdirSync(nvm)) candidates.push(join(nvm, v, "bin", "codex"));
  } catch {
    /* no nvm */
  }
  candidates.push(join(homedir(), ".bun", "bin", "codex"));
  cachedCodexBin = candidates.find((p) => existsSync(p)) ?? "codex";
  return cachedCodexBin;
}

/** Minimal spawned-process surface, injectable so the session is unit-testable. */
export interface CliProc {
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array>;
  exited: Promise<number>;
  kill(): void;
}
export type SpawnFn = (args: string[], opts: { cwd: string; env: Record<string, string> }) => CliProc;

// An allowlist, so a newly-added secret is excluded by default rather than
// leaking to a third-party subprocess. Codex authenticates via its own
// ~/.codex login, so it needs no credential of ours.
const ENV_ALLOW = new Set([
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "TERM",
  "TMPDIR",
  "TZ",
  "LANG",
  "XDG_CONFIG_HOME",
  "XDG_CACHE_HOME",
  "XDG_DATA_HOME",
]);
const ENV_ALLOW_PREFIX = ["LC_", "CODEX_"];

function subprocessEnv(extra: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v == null) continue;
    if (ENV_ALLOW.has(k) || ENV_ALLOW_PREFIX.some((p) => k.startsWith(p))) env[k] = v;
  }
  return { ...env, ...extra };
}

function defaultSpawn(args: string[], opts: { cwd: string; env: Record<string, string> }): CliProc {
  const proc = Bun.spawn([resolveCodexBin(), ...args], {
    cwd: opts.cwd,
    env: opts.env,
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    stdout: proc.stdout as ReadableStream<Uint8Array>,
    stderr: proc.stderr as ReadableStream<Uint8Array>,
    exited: proc.exited,
    kill: () => proc.kill(),
  };
}

/** Takes the reader rather than the stream so the caller can cancel a read that
 *  would otherwise never resolve. */
async function* readLines(reader: ReadableStreamDefaultReader<Uint8Array>): AsyncGenerator<string> {
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

const IDLE = Symbol("idle");

/** A cancellable deadline, used to race a read that may never resolve. */
function idleAfter(ms: number): { promise: Promise<typeof IDLE>; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout>;
  const promise = new Promise<typeof IDLE>((resolve) => {
    timer = setTimeout(() => resolve(IDLE), ms);
  });
  return { promise, cancel: () => clearTimeout(timer) };
}

const STDERR_CAP = 16_000;

/**
 * Consume stderr to EOF, keeping only the tail. Must run alongside the process:
 * an undrained pipe blocks the child once its buffer fills.
 */
function drainStderr(stream: ReadableStream<Uint8Array>): Promise<string> {
  return (async () => {
    let out = "";
    const decoder = new TextDecoder();
    const reader = stream.getReader();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      out += decoder.decode(value, { stream: true });
      if (out.length > STDERR_CAP) out = out.slice(-STDERR_CAP);
    }
    return out;
  })().catch(() => "");
}

/** A codex that emits nothing for this long is wedged, not working. */
const DEFAULT_IDLE_TIMEOUT_MS = 10 * 60 * 1000;

export class CodexBackend implements AgentBackend {
  readonly name = "codex" as const;
  private spawnFn: SpawnFn;
  private idleTimeoutMs: number;

  constructor(deps?: { spawnFn?: SpawnFn; idleTimeoutMs?: number }) {
    this.spawnFn = deps?.spawnFn ?? defaultSpawn;
    this.idleTimeoutMs = deps?.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
  }

  async openSession(ctx: AgentSessionContext): Promise<AgentSession> {
    return new CodexSession(ctx, this.spawnFn, this.idleTimeoutMs);
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
  private idledOut = false;

  constructor(
    private ctx: AgentSessionContext,
    private spawnFn: SpawnFn,
    private idleTimeoutMs: number,
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

    const proc = this.spawnFn(args, { cwd: this.ctx.cwd, env: subprocessEnv({ NIA_MCP_TOKEN: token }) });
    this.proc = proc;

    // Started now, not after exit: an undrained pipe blocks the child.
    const stderr = drainStderr(proc.stderr);

    const normalizer = new CodexNormalizer();
    const stdout = proc.stdout.getReader();
    const lines = readLines(stdout)[Symbol.asyncIterator]();
    let sawTerminal = false;
    try {
      while (true) {
        // Race the read rather than trusting kill() to close the pipe — a child
        // that ignores the signal would otherwise hang the run forever.
        const idle = idleAfter(this.idleTimeoutMs);
        const next = await Promise.race([lines.next(), idle.promise]);
        idle.cancel();
        if (next === IDLE) {
          this.idledOut = true;
          proc.kill();
          break;
        }
        if (next.done) break;

        if (this.aborted) throw new Error(this.aborted);
        const trimmed = next.value.trim();
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
          if (ev.type === "result" || ev.type === "error") sawTerminal = true;
          yield ev;
        }
      }
      if (this.idledOut) {
        yield {
          type: "error",
          message: `codex produced no output for ${Math.round(this.idleTimeoutMs / 1000)}s`,
          retryable: false,
          failover: "provider",
        };
        return;
      }
      const exit = await proc.exited;
      if (this.aborted) throw new Error(this.aborted);
      if (exit !== 0 && !sawTerminal) {
        const text = await stderr;
        yield {
          type: "error",
          message: text.trim() || `codex exited ${exit}`,
          retryable: false,
          failover: scopeOf(text, "provider"),
        };
      }
    } finally {
      await stdout.cancel().catch(() => {});
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
