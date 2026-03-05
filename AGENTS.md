# AGENTS.md

## Project Overview

**nia** is an AI sidekick daemon that runs scheduled jobs via [OpenAI Codex CLI](https://github.com/openai/codex). It's a background agent that wakes on cron schedules, executes prompts through `codex exec`, and logs results.

- **Runtime:** Bun.js
- **Package:** `niahere` on npm
- **CLI:** `nia`
- **Author:** Aman (2000.aman.sinha@gmail.com, amankumar.ai)

## Directory Structure

```
src/
  cli.ts              # Entry point, CLI commands
  core/
    daemon.ts          # Daemon lifecycle (start/stop/restart, PID, cron loop)
    runner.ts          # Job execution via codex exec, identity injection
    cron.ts            # YAML job file parsing
  utils/
    config.ts          # nia.yaml config loader
    logger.ts          # JSONL audit log + cron state
    paths.ts           # Centralized path constants
    time.ts            # Local timezone timestamp util
tests/
  core/               # Tests for core modules
  utils/              # Tests for utility modules
jobs/                  # YAML job definitions (schedule + prompt)
self/                  # Agent identity (identity.md, soul.md)
tmp/                   # Runtime artifacts (PID, logs, audit) — gitignored
```

## Build & Test

```bash
bun install            # Install dependencies
bun test               # Run all 16 tests
bun run dev            # Run daemon in foreground
```

## CLI Commands

```bash
nia start              # Start background daemon
nia stop               # Stop daemon
nia restart            # Stop + start
nia status             # Show daemon state + last job results
nia job <name>         # Run a single job manually
```

## Code Style

- TypeScript, strict mode, ESNext target
- No semicolons are optional — use them
- Imports: node builtins first, then deps, then local
- Local timestamps via `localTime()` from `src/utils/time.ts` — never raw `toISOString()` for display
- Keep modules small: core/ for business logic, utils/ for shared helpers

```ts
// Example: using localTime
import { localTime } from "../utils/time";
console.log(`[${localTime()}] event happened`);
```

## Testing

- Framework: `bun:test`
- Tests live in `tests/` mirroring `src/` structure
- Each test creates a temp dir in `/tmp/test-nia-*` and cleans up after
- Runner test is an integration test (requires `codex` in PATH, 60s timeout)

```bash
bun test                        # All tests
bun test tests/core/daemon      # Single module
```

## Key Patterns

- **Job execution:** `codex exec <prompt> -C <workspace> --ephemeral`
- **Identity injection:** `self/identity.md` + `self/soul.md` prepended to every job prompt
- **Model config:** `"default"` in nia.yaml means omit `-m` flag (uses codex default model)
- **Daemon logging:** stdout/stderr redirect to `tmp/daemon.log` via file descriptor
- **Audit trail:** Append-only JSONL at `tmp/cron-audit.jsonl`
