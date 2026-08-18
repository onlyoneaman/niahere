# AGENTS.md

## Project Overview

**nia** is a personal AI assistant daemon powered by Claude. It runs scheduled jobs, provides terminal/Telegram/Slack chat, and manages a persona system with on-demand memory and visual identity.

- **Runtime:** Bun.js
- **Package:** `niahere` on npm
- **CLI:** `nia`
- **AI:** `@anthropic-ai/claude-agent-sdk` (chat and jobs); optional Codex CLI runner
- **Database:** PostgreSQL (via `postgres` driver)
- **Image generation:** OpenAI + Gemini API (optional)
- **Author:** Aman (amankumar.ai)

## Directory Structure

```
src/
  cli/
    index.ts             # Entry point, command routing
    job.ts               # Job subcommands (list, show, status, add, update, run, log)
    agent.ts             # Agent subcommands (list, show)
    employee.ts          # Employee subcommands (add, list, show, pause, resume, remove, approvals)
    channels.ts          # Channel CLI commands (send, telegram, slack)
    phone.ts             # Phone subcommands (status, call) — outbound voice smoke-test
    self.ts              # Persona commands (rules, memory)
    watch.ts             # Slack watch channel management
    status.ts            # Status command output
    active.ts            # Active engine count/detail output
    model.ts             # Global model show/set shortcut
  core/
    daemon.ts            # Daemon lifecycle, service-aware restart, startup guard
    runner.ts            # Job execution via Claude Agent SDK query() + MCP tools; optional Codex CLI
    agents.ts            # Agent scanner — scanAgents(), getAgentsSummary(), getAgentDefinitions()
    scheduler.ts         # Job scheduling, due-time queries, cron/interval/once
    consolidator.ts      # Background memory extraction from chat sessions
    summarizer.ts        # Session summary generation for cross-session continuity
  chat/
    engine.ts            # Chat engine — Claude SDK query(), sessions, streaming
    identity.ts          # Persona loading, skill scanning, system prompt assembly
    repl.ts              # Terminal REPL chat interface
  channels/
    index.ts             # Register, start/stop all channels (incl. shared Twilio server stop)
    registry.ts          # Channel factory registry
    telegram.ts          # Telegram bot (grammY) — typing indicator
    slack.ts             # Slack bot (Bolt, Socket Mode) — thinking emoji, thread awareness
    sms.ts               # SMS via Twilio — inbound webhook → engine → REST reply
    whatsapp.ts          # WhatsApp via Twilio (Sandbox default) — enforces 24h customer-service window
    twilio/              # Shared by phone/sms/whatsapp — server, signature, REST, middleware
      server.ts          # Bun HTTP+WS server + signature/dedup/rate-limit middleware + route registry
      signature.ts       # X-Twilio-Signature HMAC-SHA1 validator
      rest.ts            # placeCall, sendMessage
      dedup.ts           # TTL set for MessageSid/CallSid dedup (Twilio retries)
      rate-limit.ts      # Sliding-window per-key limiter (default 30/min)
    phone/               # Voice — Twilio Voice + OpenAI Realtime bridge
      index.ts           # Channel class; registers routes on shared TwilioWebhookServer
      twiml.ts           # TwiML XML response builders
      relay.ts           # Twilio Media Streams ↔ OpenAI Realtime audio bridge
      instructions.ts    # System-prompt builders (inbound/outbound)
      tools.ts           # consult_claude/send_telegram/save_memory/end_call (model-callable)
      consult.ts         # Single-shot Claude escape hatch for reasoning-heavy turns
  commands/
    init.ts              # Interactive setup wizard (db, channels, persona, agents, active hours)
    service.ts           # OS service registration (launchd/systemd), service-aware restart
    db.ts                # Database setup (install postgres, create db, migrate)
    backup.ts            # Backup creation (config + persona + pg_dump), auto-prune
    validate.ts          # Config validation
    health.ts            # Health checks (daemon, db, channels, config)
    health-db.ts         # Database-specific health check
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
  agent/                 # Harness-agnostic execution seam
    types.ts             # AgentBackend/AgentSession/AgentEvent contracts
    models.ts            # Model name → provider resolution
    chain.ts             # ChainEntry + ChainCursor (advance one / skip provider)
    registry.ts          # Backend singletons, buildChain/resolveChain
    failure.ts           # Failure classification (status first, prose fallback)
    health.ts            # Process-wide provider cooldown
    mcp-endpoint.ts      # Loopback HTTP MCP endpoint for CLI backends
    message-stream.ts    # Turn queue feeding the Claude SDK query()
    backends/
      claude.ts          # In-process Claude Agent SDK adapter
      claude-normalize.ts# SDK messages → AgentEvent
      codex.ts           # `codex exec --json` subprocess adapter
      codex-normalize.ts # Codex JSONL → AgentEvent
  mcp/
    index.ts             # MCP factory (per-query Protocol instances)
    server.ts            # In-process SDK server built from NIA_TOOLS
    gate.ts              # Per-run budget for side-effect tools
    tools/
      table.ts           # The single tool table (both transports)
      types.ts           # NiaTool shape
  prompts/
    index.ts             # Prompt loading and interpolation
    environment.md       # Environment/config/memory prompt template
    mode-chat.md         # Chat mode instructions
    mode-job.md          # Job mode instructions
    channel-slack.md     # Slack-specific rules (formatting, security, thread judgement)
    channel-telegram.md  # Telegram-specific rules
  types/                 # Cross-cutting types shared by several modules
                         # (module-local types live beside their module)
    index.ts             # Barrel export
    enums.ts             # JobStatus (active/disabled/archived), ScheduleType, Mode, AttachmentType, ChannelName
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
    cli.ts               # CLI helpers (fail, parseArgs, pickFromList, TTY-aware colors)
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
agents/
  marketer/AGENT.md      # Marketing specialist agent
  senior-dev/AGENT.md    # Senior developer agent
skills/                  # 40+ skills — run `nia skills` for full list
  nia-image/             # Visual identity generation skill (Gemini)
  image-generation/      # General-purpose image generation (OpenAI + Gemini)
  llms-txt/              # Create/improve llms.txt for LLM-aware content indexing
  programmatic-seo/      # Plan/audit scalable programmatic SEO systems
  pr-reviewer/           # Language-aware PR review
  slack/                 # Slack messaging primitives
  docx/                  # Word document generation
  pptx/                  # PowerPoint generation
  ...
tests/
  agent/                 # Backend, chain, resolver, failure, health tests
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
model: claude-sonnet-5
fallback_models: [gpt-5.6-sol]   # optional; provider is derived from each name
timezone: Asia/Calcutta
log_level: info
gemini_api_key: ...
openai_api_key: ...
active_hours:
  start: "11:00"
  end: "02:00"
session_finalization:
  enabled: true
  memory_consolidation: true
  summaries: true
channels:
  enabled: true
  default: telegram
  telegram:
    enabled: true
    bot_token: ...
    chat_id: 823887567
    open: false
  slack:
    enabled: true
    bot_token: xoxb-...
    app_token: xapp-...
    dm_user_id: U06PBA2P680
```

Env vars override config: `DATABASE_URL`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`, `SLACK_CHANNEL_ID`, `GEMINI_API_KEY`, `OPENAI_API_KEY`, `LOG_LEVEL`, `TWILIO_SID`, `TWILIO_SECRET`, `TWILIO_AUTH_TOKEN`, `PHONE_FROM_NUMBER`, `PRIMARY_PHONE_USER`, `PUBLIC_BASE_URL`, `PHONE_PORT`, `PHONE_ALLOWLIST`, `PHONE_VOICE`, `PHONE_REALTIME_MODEL`, `SMS_FROM_NUMBER`, `WHATSAPP_FROM_NUMBER`.

Config can be managed via CLI: `nia config list`, `nia config get <key>`, `nia config set <key> <value>`. Supports dot notation for nested keys (e.g. `channels.default`). Use `nia channels off telegram` or `nia channels off slack` to disable a single configured channel without removing credentials.

## Build & Test

```bash
bun install            # Install dependencies
npm run test           # Typecheck + run all tests
npm run test:bun       # Run tests only (skip typecheck)
npm run typecheck      # TypeScript type check only
bun run dev            # Run daemon in foreground
```

Test isolation: tests set `NIA_HOME` env var to a temp dir and call `resetConfig()` in cleanup. DB tests use a shared `tests/db/setup.ts` that auto-creates a `niahere_test` database and points config at it.

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
- **Job status:** Jobs have three statuses: `active` (running on schedule), `disabled` (paused but visible), `archived` (hidden from list, won't run). CLI: `nia job archive/unarchive`. MCP: `archive_job`/`unarchive_job`. Unarchiving restores to `disabled`.
- **Jobs vs crons:** Jobs respect `active_hours`, crons (`always: true`) run 24/7. Both use the same `jobs` table.
- **Job execution:** Driven by the model chain — `model` plus ordered `fallback_models` in config.yaml. Each name resolves to its own provider (`claude-*` → Claude Agent SDK `query()`, `gpt-*`/`codex` → `codex exec --json`), so config never names a backend. A model-scoped failure advances one entry; a provider-scoped one skips that provider's remaining entries. Codex is resumable — `canResume` answers from codex's own rollout store (`$CODEX_HOME/sessions/YYYY/MM/DD/`, searched over a 7-day window) and a resumable turn continues via `codex exec resume` without re-sending the system prompt. Session ID stored in audit for inspection. `terminal_reason` tracks why a job ended (`completed`, `max_turns`, `aborted_tools`, etc.).
- **Job prompt files and working memory:** Jobs are stateful by default. Each job gets a workspace at `~/.niahere/jobs/<name>/`. If `prompt.md` exists and is non-empty, it overrides the DB prompt at runtime; otherwise the job uses the DB prompt. `state.md` is auto-injected into the prompt unless `stateless: true` is set. The agent updates `state.md` at the end of each run.
- **Model routing:** Global `config.model` defaults to `default` (Claude Code's tier-based default) and can be changed with `nia model <model>`. Chat sessions and jobs pass explicit non-default models to the SDK. Jobs can specify a `model` field (e.g. `haiku`, `sonnet`) that overrides agent and global model. Priority for jobs: `job.model > agent.model > config.model`. Use for cost savings on simple jobs.
- **Optimization workspaces:** The `optimize` skill creates self-contained run directories at `~/.niahere/optimizations/{slug}-{hex}/` with frozen contracts, rubrics, baselines, and JSONL result logs.
- **Replies vs control artifacts:** `src/channels/common/reply.ts` is the single place that decides whether model output is a message. `shouldSuppressReply()` is the cross-channel guard and matches control artifacts (`[NO_REPLY]`, `--help`, `-h`, empty) **exactly** — substring matching would swallow "Use `--help` to see the flags". `decideWatchReply()` is the looser watch judgement: it prefers a schema's answer and treats a sentinel mixed with content as a confused turn worth staying quiet on. The difference is deliberate; a test pins it. Never add a second sentinel parser — there were two once and they disagreed.
- **One turn per burst:** inbound messages go through `createTurnPump` (`src/channels/common/coalesce.ts`), not straight to `engine.send`. Messages arriving while a turn runs are buffered and answered together; a lone message is passed through byte-identical. Scheduling is injectable and channels pass their existing per-room `chainLock`, because `/nia <subcommand>` reaches the same engine — two locks guarding one engine is a race, not a safeguard. A batch is one turn and therefore one message row: the merged text holds each message verbatim, which is what the model saw and what `buildHandoff()` replays. Slack is wired; telegram/sms/whatsapp still send one turn per message.
- **Channel registration:** Channels export factory functions, `registerAllChannels()` wires them up explicitly. No side-effect imports.
- **Daemon lifecycle:** Blocking stop (waits for engines, escalates to SIGKILL). Service-aware restart via launchctl/systemd. Startup guard prevents duplicate daemons. `nia stop`, `nia restart`, and `nia update` guard against active engines — if engines are running, stop/restart refuse by default while update waits up to 1 minute by default. `--wait <minutes>` polls every 5s and proceeds when engines clear or timeout. `--force` skips the check, writes a short-lived force-shutdown marker for service-managed daemons, actively closes live Claude handles, clears active-engine bookkeeping, and proceeds immediately.
- **Active engines are a lease, not a flag:** a row in `active_engines` only counts as work while something re-stamps `last_ping`. Turns call `ActiveEngine.throttledTouch(room)` from their event loop (`PING_INTERVAL_MS`), and `guardActiveEngines()` ignores anything silent past `STALE_AFTER_MS`. Never ping from a timer — a timer outlives the turn it describes, so a crashed process would keep its row looking alive, which is the failure this design exists to prevent. Keep `PING_INTERVAL_MS` well under `STALE_AFTER_MS`; a test pins that.
- **Health checks:** (`src/core/health.ts`) Shared module used by both `nia health` CLI and alive monitor. Checks: version, daemon, config, DB connectivity, channel connectivity (actual API calls), model chain, API keys, persona files, logs.
- **Structured outputs:** `AgentSessionContext.outputSchema` (and `EngineOptions.outputSchema`) takes a JSON Schema that both backends enforce — Claude via `outputFormat`, codex via `--output-schema` written to a temp file. The validated object arrives as `structured` on the result event and `SendResult`. **No caller sets it yet.** The engine stores `ev.text` as the reply content, which under a schema is raw JSON — enabling a schema on a chat path today writes JSON into the message history that `buildHandoff()` replays on failover. Before the first consumer, give the engine a human-readable content to persist. `src/channels/common/reply.ts` already routes Slack watch decisions through `decideWatchReply()`, which prefers `structured` when present and falls back to the `[NO_REPLY]` sentinel, so the consumer is a one-line change once that is solved.
- **Cost vs estimate:** `costUsd` is only ever what a backend reported. Codex bills nothing per token, so `src/agent/pricing.ts` projects list rates into a separate `estimatedCostUSD` — surfaced as the `Est.` column in `nia usage` and never summed into cost. A model with no published rate stays unpriced; do not invent a rate to fill the gap.
- **Claude credential:** `src/agent/credentials.ts` resolves it — `anthropic_oauth_token` > `anthropic_api_key` > whatever `claude` last wrote to `~/.claude/.credentials.json`. Config beats the ambient environment so the daemon is not at the mercy of the shell that launched it. Prefer the oauth token from `claude setup-token`: it is long-lived and keeps the subscription, where an API key bills per token. Turn metadata records `credential` (what Nia resolved) — not the SDK's `apiKeySource`, which reports `"none"` for every OAuth path and so cannot tell a configured token from the inherited login. **The fallback is the fragile path** — the SDK spawns its own vendored `claude` binary (pinned by the SDK version, not the one on PATH), and that copy has never refreshed the shared credentials file, so Nia's uptime silently depended on a human using the CLI on the same host.
- **Sign-in state:** `src/agent/auth.ts` reads each provider's credential store (`~/.claude/.credentials.json`, `$CODEX_HOME/auth.json`) and reports expiry. Keep the distinction: an *access* token lapsing is routine (it renews on demand; an idle daemon holds one nightly) and must never be a failure, while a *refresh* token expiring is terminal and needs a human to sign in. A lapsed access token only escalates when the `failover` check shows the chain has also stopped using that provider — that correlation is what turns "something is wrong" into "your Claude sign-in lapsed 16 days ago". `alive.ts` notifies about sign-in directly, ahead of the LLM recovery agent, because the agent runs through the failing chain.
- **Failover is an incident, not a mode:** `providerHealth` (`src/agent/health.ts`) records whether each served turn came from the chain's head. The `failover` health check warns while a fallback is covering and fails once it has covered for an hour — silent failover once hid a 16-day provider outage. Backends must never report a failure without a cause: when the SDK gives an empty `errors` array, `describeFailure()` reports the status/subtype/stop reason instead, and `scopeOf` treats cause-less messages as a class so they still fail over.
- **Model chain health:** The `models` check prints the chain that will actually be walked (including the implicit provider tail) and judges each configured name against what its provider still accepts — codex models are checked against `codex debug models`. A retired name is `warn` as a fallback and `fail` as the primary. An unreadable catalog reports nothing rather than a false alarm. Providers retire model names on their own schedule, so this is the thing that catches it.
- **Alive monitor:** (`src/core/alive.ts`) 60s heartbeat runs health checks. On DB failure: (1) attempts reconnect, (2) deterministic Postgres recovery — checks `pg_isready`, removes stale `postmaster.pid` if PID is dead/recycled, restarts brew/systemd service, (3) LLM recovery agent as fallback for non-trivial issues. Notifies user with postmortem. Falls back to direct channel notification if agent fails.
- **Telegram:** Typing indicator while processing. Final response sent as fresh message.
- **Slack:** Thinking emoji reaction while processing. Thread awareness (auto-listens without @mention). Thread context (50 messages + attachments) fetched via `conversations.replies`. `[NO_REPLY]` sentinel for silent thread judgement. Watch mode: per-channel proactive monitoring via `channels.slack.watch` config — keys use `channel_id#channel_name` format. Hot-reloads via mtime tracking of config.yaml AND any referenced watch behavior files (no restart needed). File attachments of any MIME type up to 50MB are cached to disk under thread-scoped directories at `~/.niahere/tmp/attachments/slack-{channelName}-t{threadTs}/` and surfaced to the model as absolute local path hints for inspection or forwarding via `send_message media_path`. Incoming Slack messages are prefixed with `[user:ID]` in both channels and DMs so owner checks stay reliable.
- **Watch behaviors:** Each watch lives in `~/.niahere/watches/<name>/` (dir-per-watch, like agents). Contains at least `behavior.md` and may later contain `state.md` for working memory. The `behavior` field in `channels.slack.watch` is optional and has three forms: (1) omitted/empty — uses the watch name from the key (part after `#`) and loads `watches/<name>/behavior.md`; (2) single token `[a-zA-Z0-9_-]+` — explicit override, loads `watches/<token>/behavior.md`; (3) prose with whitespace — inline behavior. If the file is missing, the watch still runs but without explicit behavior (agent uses general judgement). Hot-reloads via mtime tracking of config.yaml AND any referenced behavior files.
- **Persona:** 5 files loaded every session: `identity.md`, `owner.md`, `soul.md`, `rules.md`, `memory.md`. Rules = behavioral instructions (verbs). Memory = facts and context (nouns). Both preloaded into every session automatically. Use `add_rule` / `add_memory` MCP tools, or edit files directly.
- **Two-stage memory:** Durable memory/rules are only written via a staging pipeline. Stage 1: after a chat session goes idle, the consolidator (`src/core/consolidator.ts`) reflects on the transcript and appends candidate lines to `~/.niahere/self/staging.md` (format: `- [count×] [type] content :: first_seen → last_seen`, types: `persona | project | reference | correction`). Reinforcement happens in-place — the consolidator bumps `[1×] → [2×]` instead of duplicating. Stage 2: the `memory-promoter` system job runs nightly at 3am (auto-installed via `bootstrapSystemJobs` in `daemon.ts`), reaps entries older than 14d with count<2, and promotes qualifying candidates (`count ≥ 2` + durability review) to `memory.md` or `rules.md`. Jobs do NOT flow through this pipeline — job-local learnings live in each job's `state.md` via `buildWorkingMemory()`. Routing job output through global memory caused layer violations.
- **Session finalization:** Post-session consolidation and summarization are managed by a unified finalizer (`src/core/finalizer.ts`). All callers use `finalizeSession(sessionId, room)` which writes to a `finalization_requests` table and returns instantly. The daemon listens on `nia_finalize` via pg_notify and drains pending requests on startup. In daemon mode, requests also process inline (fire-and-forget). CLI processes (`nia chat`, `nia run`) exit immediately — the daemon picks up the work. Session activity cancels pending (not yet processing) requests. `session_finalization.enabled`, `session_finalization.memory_consolidation`, and `session_finalization.summaries` in config.yaml can disable all or part of this background work; if no tasks are enabled, new requests are not enqueued and already-pending requests are marked done without running consolidator/summarizer.
- **Visual identity:** Images at `~/.niahere/images/`. Generated during `nia init` via Gemini.
- **Service:** `nia start` registers OS service (launchd/systemd). `nia restart` is service-aware.
- **Agents:** Role/domain specialists defined as `AGENT.md` files in `agents/` directories. Scanned from project `agents/`, `~/.niahere/agents/`, `~/.shared/agents/`. Passed to Claude Agent SDK as subagents via `query()` options — SDK handles routing and context isolation. Jobs can reference an agent via `agent` column — agent body becomes the systemPrompt. See [MULTI_AGENT_PHILOSOPHY.md](MULTI_AGENT_PHILOSOPHY.md).
- **Skills:** Scanned from project `skills/`, `~/.niahere/skills/`, `~/.shared/skills/`, `~/.claude/skills/`, `~/.codex/skills/`. Dedup is case-insensitive (first found wins by scan order).
- **Consistent context injection:** All prompt modes (agent chat, agent jobs, employee chat, employee jobs, watch channels) receive full context (environment, skills, agents, employees). Watch behavior is injected into the system prompt, not the user message.
- **Runtime OS context:** Environment prompts include safe OS metadata (OS/type/release, platform, architecture, shell basename) so agents choose platform-appropriate commands without dumping arbitrary env vars or home paths.
- **Paths:** All from `getPaths()` → `getNiaHome()` (`NIA_HOME` env or `~/.niahere/`)
- **One-shot jobs:** `once` schedule type auto-disables (sets status to `disabled`) after execution, hidden from `nia status`
- **Dev mode:** `nia channels off` disables all channels for local development; `nia channels off <name>` disables one configured channel (`telegram`, `slack`, `phone`, `sms`, `whatsapp`) without removing credentials.
- **DB setup:** `nia db setup` installs PostgreSQL (brew on macOS), creates database, runs migrations. Also offered during `nia init` if DB connection fails.
- **npm install:** `bin/nia` shell wrapper checks for Bun, offers to install it, resolves package path via realpath for nvm/global installs

## Employee System

Employees are persistent co-founders scoped to projects — not just role prompts like agents, but full identities with their own memory, goals, decisions, and org chart position.

### Directory Structure

Each employee lives in `~/.niahere/employees/<name>/` with:

- `EMPLOYEE.md` — identity file with YAML frontmatter (`name`, `project`, `repo`, `role`, `model`, `status`, `maxSubEmployees`) followed by freeform identity/personality
- `memory.md` — employee-specific memory
- `goals.md`, `decisions.md` — tracked per-employee
- Org chart position (who reports to whom)

### Lifecycle

`onboarding` → `active` → `paused`

- **onboarding** — initial setup, identity being defined
- **active** — fully operational, can run jobs and chat
- **paused** — temporarily inactive, retains all state

### CLI

```
nia employee add          # Create a new employee
nia employee list         # List all employees
nia employee show <name>  # Show employee details
nia employee pause <name> # Pause an employee
nia employee resume <name># Resume a paused employee
nia employee remove <name># Remove an employee
nia employee approvals    # Manage pending approvals
nia employee <name>       # Chat as employee (shorthand)
```

### Chat Integration

Unified flags: `nia chat --employee <name>`, `nia chat --agent <name>`, `nia chat --job <name>`. Employee identity loads into the session and takes precedence over agent identity when both are present.

### Job Integration

Jobs can be assigned to employees via `--employee` on CLI or `employee` parameter in MCP tools (`add_job`, `update_job`). When a job has both an employee and an agent, the employee identity takes precedence.

## Architecture Docs

- **[DOCTRINES.md](DOCTRINES.md)** — core philosophy: atomic tools, prompts as features, emergent capability
- **[MULTI_AGENT_PHILOSOPHY.md](MULTI_AGENT_PHILOSOPHY.md)** — why single-agent with skills/jobs beats multi-agent orchestration, backed by research

## Code Style

- TypeScript, strict mode, ESNext target
- Semicolons required
- Imports: node builtins first, then deps, then local. Static imports by default — `await import()` is only for genuine CLI lazy-loading or breaking a cycle, never for node builtins.
- Types: cross-cutting ones in `src/types/`; a type used by one module lives with that module. Constants in `src/constants/`, utils in `src/utils/`.
- Local timestamps via `localTime()` — never raw `toISOString()` for display
- Errors: `errMsg(err)` to read a message, `asError(err)` to normalize before rethrowing. Never hand-roll `err instanceof Error ? ... : String(err)`.
- Best-effort work that must not fail the caller uses `ignore(promise, "what it was")` — never `.catch(() => {})`. A swallowed failure has to leave a trace, or a persistent one is invisible.
- A log line must not claim something happened unless the write that made it happen succeeded.

## Releasing

**Release cadence:** Don't release with every small change. Batch changes and ask for confirmation before releasing. Only release when explicitly asked or when there are meaningful changes worth a version bump.

**Release flow:**

1. Ensure all changes are committed and tests pass (`npm run test`)
2. Move `[Unreleased]` items in `CHANGELOG.md` under a new version header (e.g. `## [0.2.50] - YYYY-MM-DD`)
3. `npm version patch --no-git-tag-version`
4. Commit changelog + package.json version bump together
5. `npm publish && git push`
6. Verify: `npm view niahere version` should show the new version

Users update on other machines with `nia update` (installs latest + auto-restarts daemon if running).

## Keeping Docs Updated

When making changes, keep these files in sync:

- **AGENTS.md** — update when: adding/moving files, changing config schema, adding key patterns
- **README.md** — update when: adding/changing CLI commands, features, setup steps
- **Prompts** (`src/prompts/*.md`) — update when: changing channel behavior, formatting rules, security policies
- **CHANGELOG.md** — add to `[Unreleased]` with every commit that adds a feature, fixes a bug, or changes behavior. Move items under new version header when releasing. **Style: `- **Bold title** — one sentence explaining impact. Max two sentences.`** No implementation details, no file paths, no internal forensics — those belong in the commit message. If you need more than two sentences, you're writing docs, not a changelog entry.
- **CLI help text** (`src/cli/index.ts` default case) — update when: adding/renaming subcommands
- **Slack manifest** (`defaults/channels/slack-manifest.json`) — update when: adding Slack API features

Run `npm run test` after changes to catch type errors and broken imports.
