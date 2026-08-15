import { existsSync, readdirSync, mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { homedir } from "os";
import { join, dirname } from "path";
import type { AgentBackend, AgentSession, AgentSessionContext, AgentEvent } from "../types";
import type { Attachment } from "../../types/attachment";
import type { McpSourceContext } from "../../mcp";
import { CodexNormalizer } from "./codex-normalize";
import { mintRun, revokeRun } from "../mcp-endpoint";
import { scopeOf, parseFailure } from "../failure";
import { ignore } from "../../utils/errors";

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

/**
 * `codex exec -i` takes a path, not bytes. Channels that cache their uploads to
 * disk (Slack, Telegram) give us one; anything held only in memory cannot be
 * passed without materializing it, so it is reported rather than dropped.
 */
export function attachmentPaths(attachments?: Attachment[]): { paths: string[]; skipped: number } {
  const paths: string[] = [];
  let skipped = 0;
  for (const a of attachments ?? []) {
    if (a.sourcePath && existsSync(a.sourcePath)) paths.push(a.sourcePath);
    else skipped++;
  }
  return { paths, skipped };
}

/** codex writes rollouts to `$CODEX_HOME/sessions/YYYY/MM/DD/rollout-<ts>-<uuid>.jsonl`. */
export function codexHome(): string {
  return process.env.CODEX_HOME || join(homedir(), ".codex");
}

/**
 * Only recent days are searched. Resume exists to continue the conversation in
 * front of us; anything older replays from Nia's own transcript instead, and
 * walking every rollout ever written (thousands of files) to prove a negative
 * would cost more than the resume saves.
 */
const RESUME_WINDOW_DAYS = 7;

export function findRollout(sessionId: string, now: Date = new Date()): string | null {
  if (!/^[0-9a-f-]{32,}$/i.test(sessionId)) return null;
  const pad = (n: number) => String(n).padStart(2, "0");
  for (let i = 0; i < RESUME_WINDOW_DAYS; i++) {
    const d = new Date(now.getTime() - i * 86_400_000);
    const dir = join(codexHome(), "sessions", String(d.getFullYear()), pad(d.getMonth() + 1), pad(d.getDate()));
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue; // no sessions that day
    }
    const hit = entries.find((f) => f.startsWith("rollout-") && f.endsWith(`${sessionId}.jsonl`));
    if (hit) return join(dir, hit);
  }
  return null;
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
    // The prompt goes in as an argument. `codex exec` still appends piped stdin
    // as a <stdin> block, so leaving it to whatever the daemon inherited lets
    // the parent's descriptor become part of the prompt.
    stdin: "ignore",
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

/** Progress chatter codex writes to stderr on a healthy run. Reporting it as
 *  the cause of a failure is how "Reading additional input from stdin..." came
 *  to be the recorded error for every job that ever failed. */
const STDERR_NOISE = [
  /^reading additional input from stdin/i,
  /^\s*$/,
  /^\[?\d{4}-\d{2}-\d{2}T[\d:.]+Z?\]?\s*$/,
  /^workdir:/i,
  /^model:/i,
  /^provider:/i,
  /^approval:/i,
  /^sandbox:/i,
  /^reasoning (effort|summaries):/i,
  /^--------$/,
  /^openai codex v/i,
];

/** Drop the chatter, keep the diagnosis. Empty means codex said nothing useful. */
export function meaningfulStderr(text: string): string {
  return text
    .split("\n")
    .map((l) => l.trimEnd())
    .filter((l) => l.trim() && !STDERR_NOISE.some((p) => p.test(l.trim())))
    .join("\n")
    .trim();
}

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

  /** codex keys rollouts by session id alone — cwd does not narrow the search. */
  async canResume(backendSessionId: string, _cwd: string): Promise<boolean> {
    return findRollout(backendSessionId) !== null;
  }
}

class CodexSession implements AgentSession {
  private _sessionId: string | null;
  private aborted: string | null = null;
  private proc: CliProc | null = null;
  private idledOut = false;

  constructor(
    private ctx: AgentSessionContext,
    private spawnFn: SpawnFn,
    private idleTimeoutMs: number,
  ) {
    this._sessionId = typeof ctx.resume === "string" ? ctx.resume : null;
  }

  get backendSessionId(): string | null {
    return this._sessionId;
  }

  async *send(text: string, attachments?: Attachment[]): AsyncIterable<AgentEvent> {
    const source: McpSourceContext = this.ctx.source ?? { channel: this.ctx.channel, room: this.ctx.room };
    const { url, token } = await mintRun(source);

    // Resuming carries the system prompt with the thread, so re-sending it would
    // stack a second copy on every turn.
    const resumable = this._sessionId && findRollout(this._sessionId);
    const prompt = resumable ? text : `${this.ctx.systemPrompt}\n\n---\n\n${text}`;
    const args = resumable ? ["exec", "resume", this._sessionId!, prompt] : ["exec", prompt];
    args.push(
      "--json",
      "--skip-git-repo-check",
      "--dangerously-bypass-approvals-and-sandbox",
      "-C",
      this.ctx.cwd,
      "-c",
      `mcp_servers.nia.url="${url}"`,
      "-c",
      `mcp_servers.nia.bearer_token_env_var="NIA_MCP_TOKEN"`,
    );
    // codex takes the schema as a file path, so it needs somewhere to live for
    // the length of the run.
    let schemaDir: string | null = null;
    if (this.ctx.outputSchema) {
      schemaDir = mkdtempSync(join(tmpdir(), "nia-codex-schema-"));
      const schemaPath = join(schemaDir, "schema.json");
      writeFileSync(schemaPath, JSON.stringify(this.ctx.outputSchema));
      args.push("--output-schema", schemaPath);
    }

    const media = attachmentPaths(attachments);
    for (const path of media.paths) args.push("-i", path);
    if (this.ctx.model && this.ctx.model !== "default") args.push("-m", this.ctx.model);
    if (media.skipped > 0) {
      yield { type: "thinking", delta: `${media.skipped} attachment(s) had no file on disk and were not sent to codex` };
    }

    const proc = this.spawnFn(args, { cwd: this.ctx.cwd, env: subprocessEnv({ NIA_MCP_TOKEN: token }) });
    this.proc = proc;

    // Started now, not after exit: an undrained pipe blocks the child.
    const stderr = drainStderr(proc.stderr);

    const normalizer = new CodexNormalizer(this.ctx.model, !!this.ctx.outputSchema);
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
        const text = meaningfulStderr(await stderr);
        yield {
          type: "error",
          message: text || `codex exited ${exit} without reporting a cause`,
          retryable: false,
          failover: scopeOf(parseFailure(text), "provider"),
        };
      }
    } finally {
      await ignore(stdout.cancel(), "cancel codex stdout reader");
      revokeRun(token);
      if (schemaDir) rmSync(schemaDir, { recursive: true, force: true });
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
