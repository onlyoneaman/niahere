# AGENTS.md

## Project Overview

**nia** is a personal AI assistant daemon powered by Claude. It runs scheduled jobs, provides terminal/Telegram/Slack chat, and manages a persona system with on-demand memory and visual identity.

- **Runtime:** Bun.js
- **Package:** `niahere` on npm
- **CLI:** `nia`
- **AI:** `@anthropic-ai/claude-agent-sdk` (chat), Codex CLI (jobs)
- **Database:** PostgreSQL (via `postgres` driver)
- **Image generation:** OpenAI + Gemini API (optional)
- **Author:** Aman (amankumar.ai)

## Directory Structure

```
src/
  cli/
    index.ts             # Entry point, command routing
    job.ts               # Job subcommands (list, show, status, add, run, log)
    channels.ts          # Channel CLI commands (send, telegram, slack)
    status.ts            # Status command output
  core/
    daemon.ts            # Daemon lifecycle, service-aware restart, startup guard
    runner.ts            # Job execution via Codex CLI (--json, session ID capture)
    scheduler.ts         # Job scheduling, due-time queries, cron/interval/once
  chat/
    engine.ts            # Chat engine — Claude SDK query(), sessions, streaming
    identity.ts          # Persona loading, skill scanning, system prompt assembly
    repl.ts              # Terminal REPL chat interface
  channels/
    index.ts             # Register, start/stop all channels
    registry.ts          # Channel factory registry
    telegram.ts          # Telegram bot (grammY) — typing indicator
    slack.ts             # Slack bot (Bolt, Socket Mode) — thinking emoji, thread awareness
  commands/
    init.ts              # Interactive setup wizard (db, channels, persona, gemini, visual identity)
    service.ts           # OS service registration (launchd/systemd), service-aware restart
    db.ts                # Database setup (install postgres, create db, migrate)
  db/
    connection.ts        # Lazy postgres init, withDb() helper
    migrate.ts           # SQL migration runner
    migrations/          # Numbered .ts migration files
    seed.ts              # DB seed script
    models/
      job.ts             # Job CRUD + pg_notify on mutations
      message.ts         # Chat message storage + room stats
      session.ts         # Session tracking
      active_engine.ts   # Active engine registry
  mcp/
    server.ts            # MCP tool server (jobs, messaging, history)
    tools.ts             # MCP tool handlers
  prompts/
    index.ts             # Prompt loading and interpolation
    environment.md       # Environment/config/memory prompt template
    mode-chat.md         # Chat mode instructions
    mode-job.md          # Job mode instructions
    channel-slack.md     # Slack-specific rules (formatting, security, thread judgement)
    channel-telegram.md  # Telegram-specific rules
  types/                 # All type definitions (types, interfaces, enums only)
    index.ts             # Barrel export
    enums.ts             # JobStatus, ScheduleType, Mode, AttachmentType, ChannelName
    config.ts            # Config, ChannelsConfig, TelegramConfig, SlackConfig
    paths.ts             # Paths interface
    attachment.ts        # Attachment interface
    audit.ts             # AuditEntry, JobState, CronState
    job.ts               # JobInput, JobResult
    engine.ts            # SendResult, ChatEngine, EngineOptions, callbacks
    channel.ts           # Channel, ChannelFactory
    chat-state.ts        # ChatState (shared between channel implementations)
    message.ts           # SaveMessageParams, RoomStats, RecentMessage
  constants/
    index.ts             # DEFAULT_DATABASE_URL + barrel
    attachment.ts        # MAX_ATTACHMENT_SIZE, IMAGE_MIMES, JPEG_QUALITY
  utils/
    config.ts            # Config loading, readRawConfig(), updateRawConfig()
    paths.ts             # Path resolution from NIA_HOME
    cli.ts               # CLI helpers (fail, pickFromList)
    errors.ts            # errMsg() helper
    log.ts               # Pino logger
    logger.ts            # JSONL audit log + cron state file
    time.ts              # Local timezone formatting
    duration.ts          # Duration string parsing
    attachment.ts        # classifyMime, validateAttachment, prepareImage
defaults/
  self/                  # Template files for nia init (identity, soul, owner, memory)
  channels/
    slack-manifest.json  # Slack app manifest with all required scopes
skills/
  nia-image/             # Visual identity generation skill (Gemini)
  image-generation/      # General-purpose image generation (OpenAI + Gemini)
  llms-txt/              # Create/improve llms.txt for LLM-aware content indexing
  github-link-repo-explorer/  # Clone and explore GitHub repos from links
  pr-reviewer/           # Language-aware PR review (design, security, performance, idioms)
  frontend-design/       # Anti-AI-slop UI design (typography, color, layout, accessibility)
tests/
  core/                  # Daemon, runner, scheduler tests
  chat/                  # Identity, engine tests
  channels/              # Channel registry tests
  db/                    # Model tests
  mcp/                   # MCP tool tests
  prompts/               # Prompt loading tests
  types/                 # Attachment utility tests
  utils/                 # Config, paths, time, format tests
```

## Config

All config lives in `~/.niahere/config.yaml` with nested channel structure:

```yaml
database_url: postgres://localhost:5432/niahere
model: default
timezone: Asia/Calcutta
log_level: info
gemini_api_key: ...
openai_api_key: ...
active_hours:
  start: '11:00'
  end: '02:00'
channels:
  enabled: true
  default: telegram
  telegram:
    bot_token: ...
    chat_id: 823887567
    open: false
  slack:
    bot_token: xoxb-...
    app_token: xapp-...
    dm_user_id: U06PBA2P680
```

Env vars override config: `DATABASE_URL`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`, `SLACK_CHANNEL_ID`, `GEMINI_API_KEY`, `OPENAI_API_KEY`, `LOG_LEVEL`.

Config can be managed via CLI: `nia config list`, `nia config get <key>`, `nia config set <key> <value>`. Supports dot notation for nested keys (e.g. `channels.default`).

## Build & Test

```bash
bun install            # Install dependencies
npm run test           # Typecheck + run all tests
npm run test:bun       # Run tests only (skip typecheck)
npm run typecheck      # TypeScript type check only
bun run dev            # Run daemon in foreground
```

Test isolation: tests set `NIA_HOME` env var to a temp dir and call `resetConfig()` in cleanup.

**Keep tests up to date.** When adding, changing, or removing functionality, add, update, or remove the corresponding tests. Good test coverage is expected — don't skip tests for new code paths.

## Code Organization

- **Types** in `src/types/` — all interfaces, type aliases, enums. No functions or constants.
- **Constants** in `src/constants/` — all constant values. No functions or types.
- **Utils** in `src/utils/` — shared utility functions. Import types from `../types`.
- **Prompts** in `src/prompts/` — markdown templates + loader. Interpolated at runtime.
- Import types directly from `../types`, functions from their module. No re-export chains.

## Key Patterns

- **Lazy DB:** `getSql()` creates connection on first use, `withDb()` wraps migrate+execute+close
- **LISTEN/NOTIFY:** Job mutations call `pg_notify('nia_jobs')`, daemon listens and auto-reloads schedules
- **Jobs vs crons:** Jobs respect `active_hours`, crons (`always: true`) run 24/7. Both use the same `jobs` table.
- **Job execution:** Configurable via `runner` in config.yaml — `"claude"` (default, uses Claude Agent SDK `query()`) or `"codex"` (uses `codex exec --json`). Session ID stored in audit for inspection.
- **Channel registration:** Channels export factory functions, `registerAllChannels()` wires them up explicitly. No side-effect imports.
- **Daemon lifecycle:** Blocking stop (waits for engines, escalates to SIGKILL). Service-aware restart via launchctl/systemd. Startup guard prevents duplicate daemons.
- **Telegram:** Typing indicator while processing. Final response sent as fresh message.
- **Slack:** Thinking emoji reaction while processing. Thread awareness (auto-listens without @mention). Thread context fetched via `conversations.replies`. `[NO_REPLY]` sentinel for silent thread judgement. Owner vs non-owner access control.
- **Persona:** 4 files loaded: `identity.md`, `owner.md`, `soul.md`, `rules.md`. Memory read/written on demand. `rules.md` is for behavioral overrides and custom instructions — edit it to change how Nia behaves without restarting.
- **Visual identity:** Images at `~/.niahere/images/`. Generated during `nia init` via Gemini.
- **Service:** `nia start` registers OS service (launchd/systemd). `nia restart` is service-aware.
- **Skills:** Scanned from project `skills/`, `~/.niahere/skills/`, `~/.shared/skills/`, `~/.claude/skills/`, `~/.codex/skills/`
- **Paths:** All from `getPaths()` → `getNiaHome()` (`NIA_HOME` env or `~/.niahere/`)
- **One-shot jobs:** `once` schedule type auto-disables after execution, hidden from `nia status`
- **Dev mode:** `nia channels off` disables Telegram/Slack for local development
- **DB setup:** `nia db setup` installs PostgreSQL (brew on macOS), creates database, runs migrations. Also offered during `nia init` if DB connection fails.
- **npm install:** `bin/nia` shell wrapper checks for Bun, offers to install it, resolves package path via realpath for nvm/global installs

## Code Style

- TypeScript, strict mode, ESNext target
- Semicolons required
- Imports: node builtins first, then deps, then local. Types from `types/`, functions from their module.
- Types only in `src/types/`, constants only in `src/constants/`, utils in `src/utils/`
- Local timestamps via `localTime()` — never raw `toISOString()` for display

## Releasing

After pushing changes, **always bump the version and publish** so that `npm i -g niahere` picks up the latest on other machines:

```bash
npm run release          # npm version patch && npm publish && git push
```

This bumps the patch version, publishes to npm, and pushes the version commit + tag. Users update with `npm i -g niahere`.

## Keeping Docs Updated

When making changes, keep these files in sync:

- **AGENTS.md** — update when: adding/moving files, changing config schema, adding key patterns
- **README.md** — update when: adding/changing CLI commands, features, setup steps
- **Prompts** (`src/prompts/*.md`) — update when: changing channel behavior, formatting rules, security policies
- **CLI help text** (`src/cli/index.ts` default case) — update when: adding/renaming subcommands
- **Slack manifest** (`defaults/channels/slack-manifest.json`) — update when: adding Slack API features

Run `npm run test` after changes to catch type errors and broken imports.
