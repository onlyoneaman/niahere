# niahere Agent Loop Design

## Summary

Minimal autonomous agent loop in Bun.js. A background daemon runs cron-scheduled jobs that execute prompts via `codex exec`. Inspired by open-bella/sentinel architecture.

## Architecture

```
niahere/
├── src/
│   ├── cli.ts          # CLI: start, stop, status
│   ├── daemon.ts       # Daemonize, PID file, signal handling
│   ├── cron.ts         # Parse jobs/*.yaml, schedule with node-cron
│   ├── runner.ts       # Bun.spawn("codex", "exec", prompt, "--json")
│   ├── config.ts       # Parse niahere.yaml
│   ├── paths.ts        # Centralized path constants
│   └── logger.ts       # JSONL append-only audit logger
├── self/
│   ├── identity.md     # Agent identity/personality
│   └── soul.md         # Behavior contract
├── jobs/
│   └── heartbeat.yaml  # Every 5 min heartbeat
├── tmp/                # Runtime artifacts (gitignored)
│   ├── niahere.pid
│   ├── daemon.log
│   ├── cron-state.json
│   └── cron-audit.jsonl
├── niahere.yaml        # Config
├── package.json
├── tsconfig.json
└── .gitignore
```

## Components

### CLI (`src/cli.ts`)
Entry point. Commands: `start` (daemonize), `stop` (SIGTERM via PID), `status` (show running state + last job results).

### Daemon (`src/daemon.ts`)
Spawns detached child via `Bun.spawn`, writes PID file to `tmp/niahere.pid`, handles SIGTERM/SIGINT for graceful shutdown.

### Cron (`src/cron.ts`)
Reads `jobs/*.yaml`, schedules with `node-cron`. Job YAML format:
```yaml
schedule: "*/5 * * * *"
enabled: true
prompt: |
  Your task description here.
```

### Runner (`src/runner.ts`)
Executes a job by shelling out to `codex exec`:
```ts
Bun.spawn(["codex", "exec", job.prompt, "--json"], {
  stdout: "pipe",
  stderr: "pipe",
});
```
Captures output, logs audit record to `tmp/cron-audit.jsonl`, updates `tmp/cron-state.json`.

### Config (`niahere.yaml`)
```yaml
model: codex-mini-latest
active_hours:
  start: "00:00"
  end: "23:59"
```

### Logger (`src/logger.ts`)
Append-only JSONL to `tmp/cron-audit.jsonl`. Each entry:
```json
{"job": "heartbeat", "timestamp": "...", "status": "ok", "result": "...", "duration_ms": 123}
```

### Paths (`src/paths.ts`)
Single source of truth for all file paths (workspace-relative).

## Data Flow

```
start → daemon.ts spawns detached child
      → child loads niahere.yaml + jobs/*.yaml
      → node-cron schedules each enabled job
      → on trigger: runner.ts calls codex exec
      → captures stdout (final message) + stderr (progress)
      → logs to tmp/cron-audit.jsonl
      → updates tmp/cron-state.json

stop  → reads PID file → sends SIGTERM → daemon cleans up
status → reads PID file + cron-state.json
```

## Dependencies

- `node-cron` — POSIX cron scheduling
- `js-yaml` — YAML parsing
- `typescript` — dev

No AI SDK dependencies. `codex` CLI is the agent runtime.

## MVP Job: Heartbeat

```yaml
# jobs/heartbeat.yaml
schedule: "*/5 * * * *"
enabled: true
prompt: |
  You are a heartbeat monitor. Write the current UTC timestamp
  and a brief status message. This is a liveness check.
```

## Decisions

- **Runtime:** Bun.js
- **Scheduling:** node-cron (POSIX cron expressions)
- **Agent execution:** `codex exec` CLI (not SDK)
- **Process model:** Background daemon with PID file
- **Job format:** YAML files in `jobs/` directory
- **Logging:** Append-only JSONL audit trail
- **Identity:** `self/` directory with identity.md + soul.md
