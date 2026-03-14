# AGENTS.md

## Project Overview

**nia** is a personal AI assistant daemon powered by Claude. It runs scheduled jobs, provides terminal/Telegram/Slack chat, and manages a persona system with on-demand memory and visual identity.

- **Runtime:** Bun.js
- **Package:** `niahere` on npm
- **CLI:** `nia`
- **AI:** `@anthropic-ai/claude-agent-sdk` (chat), Codex CLI (jobs)
- **Database:** PostgreSQL (via `postgres` driver)
- **Image generation:** Gemini API (optional)
- **Author:** Aman (amankumar.ai)

## Directory Structure

```
src/
  cli/
    index.ts             # Entry point, command routing
    job.ts               # Job subcommands (list, show, status, add, run, log, etc.)
    helpers.ts           # Shared CLI helpers (fail, pickFromList)
    status.ts            # Status command output
  core/
    daemon.ts            # Daemon lifecycle, cron scheduling, active hours, LISTEN/NOTIFY
    runner.ts            # Job execution via Codex CLI (--json mode, session ID capture)
    cron.ts              # YAML job file parsing (legacy)
    scheduler.ts         # Job scheduling and due-time queries
  chat/
    engine.ts            # Chat engine — Claude SDK query(), sessions, streaming
    identity.ts          # Persona loading, skill scanning, system prompt building
    repl.ts              # Terminal REPL chat interface
  channels/
    channel.ts           # Channel interface + registry
    index.ts             # Start/stop all channels
    telegram.ts          # Telegram bot (grammY) — typing indicator, no placeholder messages
    slack.ts             # Slack bot (Bolt, Socket Mode) — thinking emoji, thread awareness, context fetching
  commands/
    init.ts              # Interactive setup wizard (db, channels, persona, gemini, visual identity)
    service.ts           # OS service registration (launchd/systemd)
  db/
    connection.ts        # Lazy postgres init, withDb() helper
    migrate.ts           # SQL migration runner
    migrations/          # Numbered .ts migration files
    seed.ts              # DB seed script
    models/
      job.ts             # Job CRUD + pg_notify on mutations (has `always` flag for crons)
      message.ts         # Chat message storage + room stats
      session.ts         # Session tracking
      active-engine.ts   # Active engine registry
  mcp/
    server.ts            # MCP tool server (jobs, messaging, history)
    tools/               # MCP tool handlers
  utils/
    config.ts            # Unified config from ~/.niahere/config.yaml
    paths.ts             # All paths resolve from ~/.niahere/
    errors.ts            # errMsg() helper
    log.ts               # Pino logger
    logger.ts            # JSONL audit log + cron state file
    time.ts              # Local timezone formatting
  types/
    attachment.ts        # Attachment types for image/document handling
defaults/
  self/                  # Template files for nia init (identity, soul, owner, memory)
  channels/
    slack-manifest.json  # Slack app manifest with all required scopes
skills/
  nia-image/             # Visual identity generation skill
    SKILL.md             # Skill definition
    scripts/
      generate_image.py  # Gemini image generation script
    assets/              # Default reference + profile images
    references/
      prompt-guide.md    # Structured prompt system and templates
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
| `telegram_chat_id`  | `TELEGRAM_CHAT_ID`    | null (auto-registered on first message) |
| `telegram_open`     | —                     | false (only owner can message)   |
| `slack_bot_token`   | `SLACK_BOT_TOKEN`     | null                             |
| `slack_app_token`   | `SLACK_APP_TOKEN`     | null                             |
| `slack_channel_id`  | `SLACK_CHANNEL_ID`    | null                             |
| `slack_dm_user_id`  | —                     | null (auto-registered on first DM) |
| `default_channel`   | —                     | `telegram`                       |
| `gemini_api_key`    | `GEMINI_API_KEY`      | null                             |
| `log_level`         | `LOG_LEVEL`           | `info`                           |
| `model`             | —                     | `default`                        |
| `timezone`          | —                     | system timezone                  |
| `active_hours`      | —                     | `{ start: "00:00", end: "23:59" }` |

## Build & Test

```bash
bun install            # Install dependencies
bun test               # Run all tests
bun run dev            # Run daemon in foreground
```

Test isolation: tests set `NIA_HOME` env var to a temp dir and call `resetConfig()` in cleanup.

## Key Patterns

- **Lazy DB:** `getSql()` creates connection on first use, `withDb()` wraps migrate+execute+close
- **LISTEN/NOTIFY:** Job mutations call `pg_notify('nia_jobs')`, daemon listens and auto-reloads schedules
- **Jobs vs crons:** Jobs respect `active_hours`, crons (`always: true`) run 24/7. Both use the same `jobs` table.
- **Job execution:** Jobs run via `codex exec --json`, output parsed for session ID and agent message. Session ID stored in audit for `codex resume` inspection. Full Codex sessions persisted at `~/.codex/sessions/`.
- **Telegram:** Typing indicator (`sendChatAction`) shown while processing. No placeholder messages — final response sent as a fresh message.
- **Slack:** Thinking emoji reaction (🤔) added while processing, removed on completion. Thread awareness: once nia replies in a thread, she auto-listens to follow-ups without needing @mention (checks in-memory map + DB). Thread context fetched via `conversations.replies` so nia sees the full conversation.
- **Slack manifest:** `defaults/channels/slack-manifest.json` includes all required scopes (reactions, files, channels:join, users.profile, pins, bookmarks, links). Update manifest in Slack dashboard when scopes change.
- **Persona:** 3 files loaded into system prompt: `identity.md`, `owner.md`, `soul.md`. Memory (`memory.md`) is read/written on demand, not loaded automatically.
- **Templates:** `defaults/self/` contains templates with `{{placeholders}}`, interpolated during `nia init`
- **Visual identity:** Images stored at `~/.niahere/images/`. Script looks for user reference there first, falls back to skill defaults. Generated during `nia init` if Gemini key is configured.
- **Service:** `nia start` auto-registers OS service (launchd on macOS, systemd on Linux)
- **Skills:** Scanned from project `skills/`, `~/.niahere/skills/`, `~/.shared/skills/`, `~/.claude/skills/`, `~/.codex/skills/`
- **Error helpers:** Use `errMsg(err)` instead of `err instanceof Error ? err.message : String(err)`
- **Paths:** All paths from `getPaths()` which resolves from `getNiaHome()` (`NIA_HOME` env or `~/.niahere/`)

## Code Style

- TypeScript, strict mode, ESNext target
- Semicolons required
- Imports: node builtins first, then deps, then local
- Local timestamps via `localTime()` — never raw `toISOString()` for display
- Keep modules small: core/ for daemon logic, chat/ for AI interactions, utils/ for shared helpers

## Keeping Docs Updated

When making changes, keep these files in sync:

- **AGENTS.md** — update when: adding/moving files, changing config schema, adding key patterns, modifying architecture
- **README.md** — update when: adding/changing CLI commands, adding features, changing setup steps
- **System prompt** (`src/chat/identity.ts` `buildEnvironmentContext()`) — update when: adding CLI commands the agent should know about, changing job/config behavior
- **CLI help text** (`src/cli/index.ts` default case, `src/cli/job.ts` default case) — update when: adding/renaming subcommands
- **Slack manifest** (`defaults/channels/slack-manifest.json`) — update when: adding new Slack API features that need scopes

Run `nia test` after doc changes to catch any broken imports.
