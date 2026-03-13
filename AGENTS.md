# AGENTS.md

## Project Overview

**nia** is a personal AI assistant daemon powered by Claude. It runs scheduled jobs, provides terminal and Telegram chat, and manages a persona system with auto-memory.

- **Runtime:** Bun.js
- **Package:** `niahere` on npm
- **CLI:** `nia`
- **AI:** `@anthropic-ai/claude-agent-sdk`
- **Database:** PostgreSQL (via `postgres` driver)
- **Author:** Aman (amankumar.ai)

## Directory Structure

```
src/
  cli.ts                 # Entry point, all CLI commands
  core/
    daemon.ts            # Daemon lifecycle, cron scheduling, LISTEN/NOTIFY
    runner.ts            # Job execution via Claude Agent SDK
    cron.ts              # YAML job file parsing (legacy)
  chat/
    engine.ts            # Chat engine — Claude SDK query(), sessions, streaming
    identity.ts          # Persona loading, skill scanning, system prompt
    repl.ts              # Terminal REPL chat interface
  channels/
    channel.ts           # Channel interface + registry
    index.ts             # Start/stop all channels
    telegram.ts          # Telegram bot channel (grammY)
  commands/
    init.ts              # Interactive setup wizard
    service.ts           # OS service registration (launchd/systemd)
  db/
    connection.ts        # Lazy postgres init, withDb() helper
    migrate.ts           # SQL migration runner
    migrations/          # Numbered .sql migration files
    seed.ts              # DB seed script
    models/
      job.ts             # Job CRUD + pg_notify on mutations
      message.ts         # Chat message storage + room stats
      session.ts         # Session tracking
      active-engine.ts   # Active engine registry
  utils/
    config.ts            # Unified config from ~/.niahere/config.yaml
    paths.ts             # All paths resolve from ~/.niahere/
    errors.ts            # errMsg() helper
    log.ts               # Pino logger
    logger.ts            # JSONL audit log + cron state file
    time.ts              # Local timezone formatting
defaults/
  self/                  # Template files for nia init (identity, soul, etc.)
tests/
  core/                  # Daemon, cron, runner tests
  chat/                  # Identity/persona tests
  db/                    # Model tests
  utils/                 # Config, paths, time tests
```

## Config

All config lives in `~/.niahere/config.yaml`. Env vars override config values:

| Config key           | Env override          | Default                          |
|---------------------|-----------------------|----------------------------------|
| `database_url`      | `DATABASE_URL`        | `postgres://localhost:5432/niahere` |
| `telegram_bot_token`| `TELEGRAM_BOT_TOKEN`  | null                             |
| `telegram_chat_id`  | `TELEGRAM_CHAT_ID`    | null                             |
| `log_level`         | `LOG_LEVEL`           | `info`                           |
| `model`             | —                     | `default`                        |
| `timezone`          | —                     | system timezone                  |

## Build & Test

```bash
bun install            # Install dependencies
bun test               # Run all 51 tests
bun run dev            # Run daemon in foreground
```

Test isolation: tests set `NIA_HOME` env var to a temp dir and call `resetConfig()` in cleanup.

## Key Patterns

- **Lazy DB:** `getSql()` creates connection on first use, `withDb()` wraps migrate+execute+close
- **LISTEN/NOTIFY:** Job mutations call `pg_notify('nia_jobs')`, daemon listens and auto-reloads schedules
- **Persona:** 4 files loaded in order: `identity.md`, `owner.md`, `soul.md`, `memory.md`
- **Templates:** `defaults/self/` contains templates with `{{placeholders}}`, interpolated during `nia init`
- **Service:** `nia start` auto-registers OS service (launchd on macOS, systemd on Linux)
- **Skills:** Scanned from `~/.shared/skills/`, `~/.claude/skills/`, `~/.codex/skills/` — YAML frontmatter parsed with js-yaml
- **Error helpers:** Use `errMsg(err)` instead of `err instanceof Error ? err.message : String(err)`
- **Paths:** All paths from `getPaths()` which resolves from `getNiaHome()` (`NIA_HOME` env or `~/.niahere/`)

## Code Style

- TypeScript, strict mode, ESNext target
- Semicolons required
- Imports: node builtins first, then deps, then local
- Local timestamps via `localTime()` — never raw `toISOString()` for display
- Keep modules small: core/ for daemon logic, chat/ for AI interactions, utils/ for shared helpers
