# Changelog

## [0.2.67] - 2026-04-15

### Fixed

- **Watch behavior in system prompt** — watch channel behavior was prepended to the user message (weak, overridable). Now injected into the system prompt as a dedicated "Watch Mode" section.
- **Consistent context across all prompt modes** — agent prompts (chat + jobs) were losing environment, skills, agents, and employees when the agent body replaced the system prompt. All modes now get full context via `buildContextSuffix()`.
- **Employee job mode** — employee prompts on jobs used mode-chat instead of mode-job. `buildEmployeePrompt` now accepts a mode parameter.

## [0.2.66] - 2026-04-14

### Added

- **Job status lifecycle** — jobs now have `status: active | disabled | archived` replacing the `enabled` boolean. Archived jobs are hidden from `nia job list` and `nia status`. CLI: `nia job archive/unarchive`. MCP: `archive_job`, `unarchive_job`.
- **Engine guard on stop/restart/update** — refuses to stop, restart, or update while active engines are running. `--wait <minutes>` polls until clear, `--force` skips the check.
- **Employee chat shortcut** — `nia employee <name>` opens chat directly.
- **Employee tests** — 12 new tests covering getEmployeeDir, getEmployeesSummary, listEmployeesForMcp, dirName, onboarding instructions injection, status-conditional prompt, state file loading, archived job status.

### Fixed

- **Consolidator staging criteria too strict** — two-stage memory pipeline was effectively dead. Relaxed to include corrections during tasks, architecture learned while debugging, workflow patterns, and explicit "remember this" requests.

### Changed

- **environment.md** — added employees section, archive/unarchive/list_employees MCP tools, employee param on jobs, job status documentation.
- **AGENTS.md** — added employee system section with directory structure, lifecycle, CLI, chat and job integration.

## [0.2.65] - 2026-04-14

### Fixed

- **Consolidator staging criteria too strict** — two-stage memory pipeline was effectively dead. Most sessions are task execution, which was explicitly excluded. Relaxed criteria to include corrections during tasks, architecture learned while debugging, workflow patterns, and explicit "remember this" requests.

## [0.2.64] - 2026-04-14

### Added

- **Employee system** — first-class persistent entities that live inside Nia. Employees are co-founders scoped to a project repo, with identity, memory, goals, approval queue, and onboarding flow (brief → self-discovery → plan). CLI: `nia employee add|list|show|pause|resume|remove|approvals`.
- **Unified chat context** — `nia chat` accepts `--agent`, `--employee`, or `--job` to set the session persona. Each context gets its own session room.
- **Employee chat shortcut** — `nia employee kira` opens chat directly, same as `nia chat --employee kira`.
- **Employee on jobs** — jobs support `--employee` alongside `--agent`. Employee identity takes precedence. MCP tools (`add_job`, `update_job`) accept `employee` parameter.
- **Agent-driven onboarding** — `nia employee add` with zero args scaffolds and drops into chat. The employee asks for missing info (name, project, repo) conversationally. Suggests real names for placeholders.
- **Employee MCP tool** — `list_employees` for employee discovery. Employees also appear in Nia's system prompt summary.
- **Employee in backups** — `~/.niahere/employees/` now included in `nia backup`.
- **DB migration 015** — adds `employee` column to jobs table.

### Fixed

- **Deterministic agent/skill scanning** — `scanAgents()` and `scanSkills()` now sort directory entries by name. Prevents prompt cache invalidation from filesystem-order variance.
- **`engine.close()` race condition** — finalization now awaits before DB connection closes. Fixes `CONNECTION_ENDED` errors on exit.
- **`listDue()` missing employee column** — scheduled jobs with employees would silently run without employee identity.
- **Employee dir rename safety** — `getEmployeeDir()` resolves via frontmatter scan, not path assumption. Agent updates name in frontmatter only, directory stays stable.

## [0.2.63] - 2026-04-12

### Fixed

- **Daemon process detection regex** — was matching a non-existent path, so `findDaemonPids()` always returned empty. Could allow a second daemon to start. Fixed to match the real entry path.
- **Finalizer silently marked `done` on task failure** — consolidator/summarizer errors were swallowed at multiple layers. The full chain now propagates errors; finalizer marks `failed` if either task rejects.
- **`Job.update` didn't recompute `next_run_at` on schedule changes** — scheduler kept firing at the old cadence. Now recomputes inline when schedule or scheduleType changes.
- **`add_memory` description contradicted two-stage memory flow** — MCP tool and env.md still said "proactively save, don't wait to be asked." Aligned both with the new user-explicit-only save policy.

### Added

- **Integration tests for finalizer and scheduler** — concurrent dedupe, done-row skip, schedule-update recompute, cron→interval type switch.
- **Import cycle detection** — broke all 4 existing cycles (extracted pid, schedule math, and withDb to leaf utilities). Added `check:cycles` via madge, wired into `bun run test`.
- **Direct deps** — declared `zod` and `@anthropic-ai/sdk` which were only available transitively.

### Changed

- **Environment system prompt updated** — added `model` to job tool descriptions (0.2.59), dir-per-watch to Slack watch reference (0.2.61), two-stage memory docs and trimmed "When to save" from 16-row proactive tables to a 4-row user-explicit table (0.2.62).

## [0.2.62] - 2026-04-11

### Changed

- **Two-stage memory architecture** — consolidator now writes candidates to `staging.md` instead of directly to `memory.md`. A nightly `memory-promoter` job (auto-installed) reviews candidates with count ≥ 2 and promotes qualifying ones. Candidates with count < 2 expire after 14 days. Replaces the single-pass consolidator that was producing low-precision memories.
- **Job runs removed from global consolidator** — job-local learnings stay in each job's `state.md`. Routing job output through global persona memory was a layer violation.
- **Consolidator prompt rewritten around reflection** — three reflection questions instead of category extraction. Defaults to doing nothing. Explicitly overrides the "save proactively" framing from `environment.md`.

### Added

- **`userinterface-wiki` skill** — 152-rule UI/UX best-practices reference covering animations, timing, easing, Laws of UX, typography, and visual design. Wired as a companion reference from `frontend-design`, `code-review`, `qa`, and `cro`.

### Fixed

- **`nia validate` rejected watches without inline behavior** — validator was still enforcing the old required-behavior rule after the dir-per-watch rework. Now accepts watches with no `behavior` field and labels them `[file (default)]` in the output.

## [0.2.61] - 2026-04-11

### Added

- **Dir-per-watch layout + optional behavior** — each Slack watch is now a directory at `~/.niahere/watches/<name>/`. The `behavior` field is optional: omit for file-backed default, single word for directory override, or inline prose. Hot-reloads via mtime tracking.

### Improved

- **Unified session finalizer** — DB-backed finalization queue replaces ad-hoc consolidation calls. REPL/CLI exits are now instant; daemon picks up the work via `pg_notify`.

## [0.2.60] - 2026-04-09

### Improved

- **CLAUDE.md prompt hardening** — added banned filler phrases list, web search guidelines with data freshness tiers (volatile/recent/stable), user-override-defaults principle, and tighter communication style rules (lead with answer, no hedging). Inspired by competitive prompt analysis.
- **Skills consolidation** — merged 20+ standalone skills into router skills (email, seo, cro, marketing, copywriting, plan-review, code-review). ~12,400 lines removed across 59 files.

## [0.2.59] - 2026-04-09

### Added

- **Per-job model override** — jobs can now specify a model (`--model haiku`, `--model sonnet`) that overrides the agent model and global config. Enables cost savings by routing simple jobs to cheaper models. Priority: job model > agent model > config model. Supports CLI (`nia job add/update --model <model>`) and MCP tools.
- **SDK upgrade to v0.2.97** — bumped from v0.2.74. Adds `terminal_reason` to job and chat results, showing exactly why an agent stopped (`completed`, `max_turns`, `aborted_tools`, `hook_stopped`, etc.). Surfaced in `nia job run` output, audit logs, and message metadata.
- **Beads-tasks skill expanded** — added core commands reference, workflow examples, and query/filter patterns

### Fixed

- **`nia job run` and `nia run` hang after completion** — background consolidation kept the event loop alive, preventing the process from exiting. Both commands now exit immediately after printing results.

## [0.2.58] - 2026-04-09

### Added

- **Optimization loop skill** — Karpathy Loop / autoresearch pattern as a reusable skill. Frozen contract + rubric, pairwise scoring, staged exploration, JSONL audit trail. Domain-agnostic.
- **Optimize skill** — orchestration layer for scheduling optimization runs against a measurable target.

### Tests

- **Scheduler integration tests** — one-shot auto-disable, `listDue` filtering (enabled + due only), `markRun` advancing `next_run_at`, invalid schedule error handling
- **Active engine tracking tests** — verifies `list()` no longer deletes stale entries, register upsert, `ping()` updates, `clearAll`
- **Test DB auto-creation** — shared `tests/db/setup.ts` creates `niahere_test` database automatically on first run

### Fixed

- **Multi-turn user messages not persisted** — only the first message per session was saved. Now saved before pushing to the stream.
- **Active-engine tracking broken for long tasks** — `list()` silently deleted entries older than 5 min. Long-running chats/jobs could vanish and get terminated.
- **Consolidation one-shot forever** — sessions were permanently marked as processed, preventing re-consolidation on new turns. Now uses a bounded message-count map.
- **DB tests hit production** — now auto-creates `niahere_test` database.
- **Backup exposed DB credentials via `ps`** — now passes password via `PGPASSWORD` env var.
- **Case-sensitive skill/agent dedup** — dedup is now case-insensitive.
- **False "telegram: unreachable" alerts** — health checks now retry 3× with backoff. Transient network blips no longer trigger the LLM recovery agent.

## [0.2.57] - 2026-04-07

### Added

- **Job working memory** — jobs are stateful by default. Each gets a persistent workspace at `~/.niahere/jobs/<name>/` with `state.md` injected into each run's prompt. Opt out with `--stateless yes`.

## [0.2.56] - 2026-04-07

### Added

- **AWS CLI skill** — reference guide for AWS CLI usage, auth troubleshooting (default profile vs SSO), and common commands for S3, DynamoDB, CloudWatch, Lambda, STS, IAM. Includes Kay-specific context (account, buckets, tables, region).

### Fixed

- **Slack image messages silently dropped** — `file_share` subtype was caught by a blanket subtype guard. Image pipeline was built but never reached. Now allowed through.

## [0.2.55] - 2026-04-05

### Added

- **Marketing execution skills** — added 5 skills from coreyhaines31/marketingskills: product-marketing-context (foundational context), copywriting, page-cro, seo-audit, and launch-strategy
- **Conversion funnel skills** — customer-research, competitor-alternatives, onboarding-cro, signup-flow-cro, churn-prevention
- **Outreach & content skills** — social-content, email-sequence, copy-editing, ai-seo, cold-email
- **Minimalist review skill** — decision audit tool from slavingia/skills (8-principle business decision framework)

## [0.2.54] - 2026-04-04

### Added

- **Google Workspace CLI skill** — reference guide for `gws` CLI setup, usage, multi-account config, and helper commands (Gmail, Drive, Calendar, Sheets, etc.)

## [0.2.52] - 2026-04-01

### Fixed

- **Concurrent job execution guard** — jobs that take longer than their interval no longer spawn duplicate instances. Scheduler skips if the previous run is still in progress, runs again as soon as it finishes.

### Added

- **Shared `parseArgs()` utility** — consistent flag parsing across all CLI commands. Supports `--flag value`, `--flag` (bool), `--no-flag`, `-h`/`--help`, `--` separator, and positional args.
- **`--help`/`-h` support** on all commands and subcommands (`nia --help`, `nia job --help`, etc.)
- **TTY detection** — colors and ANSI codes disabled when output is piped
- **`--prompt` and `--prompt-file`** flags for `nia job add` and `nia job update` — supports inline text, quoted strings, or reading from a file for long/multi-line prompts

### Changed

- **Documentation updated** — README.md and AGENTS.md brought up to date with all current commands, features, architecture, and release process. Fixed stale descriptions (Codex runner, memory on-demand, missing CLI files/commands/skills).
- `fail()` outputs to stderr instead of stdout
- Global help text reorganized into sections (Daemon, Chat, Jobs, Persona, Channels, System) with all commands listed
- `nia job add/update` refactored to use `parseArgs` instead of hand-rolled argv slicing
- Unknown commands/subcommands print error to stderr and exit 1

## [0.2.52] - 2026-04-01

### Fixed

- `nia job update --always` could only enable always-on, never disable it. Added `--no-always` flag.

## [0.2.51] - 2026-03-30

### Fixed

- **Schedule type mismatch can't happen anymore** — job create and update now validate that the schedule string matches the declared schedule_type (cron/interval/once). A mismatch throws a clear error instead of crashing the scheduler later.
- **`update_job` now supports `schedule_type`** — was silently ignored before, so Nia couldn't fix a mismatched job without raw SQL.

## [0.2.50] - 2026-03-30

### Fixed

- **Invalid cron expression crashes daemon** — a bad schedule (e.g. `0` in month field) on any job would crash `computeNextRun`, propagate as unhandled rejection, and kill the entire daemon. Now caught — job is auto-disabled with an error log instead.

## [0.2.49] - 2026-03-30

### Fixed

- Session metadata accumulation is now atomic SQL — no read-then-write race condition
- Session metadata accumulation is non-blocking — doesn't delay reply delivery

### Changed

- `nia chat` defaults to new session instead of continuing the last one. Use `--continue`/`-c` to resume.

## [0.2.48] - 2026-03-30

### Added

- **Message metadata** — JSONB column on messages storing cost_usd, turns, duration_ms, duration_api_ms, stop_reason, token usage, and per-model breakdown on every agent reply.
- **Session metadata** — JSONB column on sessions with aggregated totals: total_cost_usd, total_turns, total_duration_ms, total_tokens, models_used, channel. Accumulated on each reply.

## [0.2.47] - 2026-03-29

### Added

- **`runTask` wrapper** — standard way to run background agent tasks with ActiveEngine tracking and MCP tools. Consolidator, summarizer, and future background tasks use this instead of calling `runJobWithClaude` directly.
- **MCP tools for all jobs** — `runJobWithClaude` now passes MCP servers to the SDK, so cron jobs and background tasks get access to `add_memory`, `send_message`, `list_jobs`, etc.

### Changed

- Consolidator and summarizer refactored to use `runTask` — now visible in `nia status` as `_system/consolidator` and `_system/summarizer`.

## [0.2.46] - 2026-03-29

### Added

- **Session summaries for cross-session continuity** — when a chat session goes idle, generates a brief handoff note summarizing what was discussed. Last 3 summaries injected into the system prompt so new sessions have context about recent conversations.
- New `src/core/summarizer.ts` — lightweight summary generation on session idle
- New migration `009_session_summary` — adds `summary` column to sessions table

## [0.2.45] - 2026-03-29

### Added

- **Background memory consolidation** — automatic memory extraction when chat sessions go idle or jobs complete. Decouples memory formation from task execution using the same agent loop as cron jobs. The agent reviews the conversation transcript with full tool access and saves memories/rules via `add_memory`/`add_rule`. Inspired by hippocampal replay during sleep — the brain consolidates memories after the experience, not during.
- **Post-job consolidation** — job runs now trigger memory extraction on completion, so insights from cron jobs, monitoring tasks, and one-off runs are captured too. Self-referential jobs (`memory-consolidation`) are skipped to prevent infinite loops.
- New `src/core/consolidator.ts` — the extraction engine with transcript formatting, prompt construction, and session dedup guard.

## [0.2.44] - 2026-03-29

### Fixed

- **Idle timer kills active requests** — 10-minute idle timer from a previous reply would fire mid-request, killing the Claude subprocess and its subagents. `send()` now clears the idle timer, and `teardown()` refuses to kill if a request is pending.
- **Orphaned pending promise hangs forever** — if the Claude SDK stream ended without a `result` message (subprocess crash, idle timer kill), the Promise returned by `send()` would never resolve, permanently blocking the Slack/Telegram lock. Now detected and rejected with a clear error.
- **Slack reply send errors silently swallowed** — if `say()` failed in the error handler, the error was lost. Now `.catch()` added consistently.

### Added

- **Message delivery tracking** — new `delivery_status` column on messages (`pending` → `sent` / `failed`). Engine saves replies as `pending` before channel send; Slack/Telegram update to `sent` on success or `failed` on error. `Message.getUndelivered()` available for future retry logic.
- **Long-running request warning** — logs a warning (once) when an engine request has been running for 30+ minutes.

### Changed

- `loadIdentity` test updated to match current behavior (memory.md is now loaded)

## [0.2.43] - 2026-03-28

### Added

- `nia backup` — create compressed backup of config, persona files, and database (pg_dump)
- `nia backup list` — show existing backups with size and date
- Auto-backup before `nia update` for safety
- Auto-prune keeps last 10 backups

### Changed

- Memory (`memory.md`) now preloaded into every session alongside rules — was read-on-demand, which meant it rarely got used in quick exchanges
- Rewrote rules vs memory guidance with clearer decision criteria, concrete examples, and self-generated learning (Nia saves from its own reasoning, not just explicit user instructions)

## [0.2.42] - 2026-03-28

### Fixed

- Concurrent Slack messages crash daemon — MCP Protocol instance was shared across queries, causing "Already connected to a transport" fatal error. Each query now gets its own MCP server instance.

### Changed

- `nia channels on/off` applies immediately via SIGHUP — no restart required

## [0.2.41] - 2026-03-23

### Added

- Conversation history MCP tools: `list_sessions`, `search_messages`, `read_session` — agent can now browse, search, and read prior conversations
- Agent prompt updated to document conversation history access

## [0.2.40] - 2026-03-23

### Added

- Deterministic Postgres recovery in alive monitor — removes stale `postmaster.pid` and restarts service before falling back to LLM recovery agent

### Fixed

- Job status race condition — concurrent jobs clobbered each other's state file, causing false "error" status after daemon restart

## [0.2.39] - 2026-03-21

### Fixed

- fix: `nia stop` failed to kill daemon processes started with relative paths — `findDaemonPids()` pgrep pattern now matches both absolute and relative `src/cli.ts run` invocations

## [0.2.38] - 2026-03-20

### Added

- Agent support — role/domain-specialized AGENT.md files in `agents/` directories
- Agents passed to Claude Agent SDK as subagents for automatic delegation
- Jobs can reference agents via `--agent` flag (agent body becomes system prompt)
- `nia agent list` and `nia agent show` CLI commands
- `list_agents` MCP tool
- Example agents: marketer, senior-dev

## [0.2.37] - 2026-03-20

- fix: silence launchd log spam — exit 0 + debug-level log when another daemon is already running, use `SuccessfulExit` KeepAlive policy to prevent respawn loop
- fix: prevent Slack handler crash from killing daemon — catch `getState` failures, add `.catch()` to lock chain, normalize unhandled rejection reasons for proper logging

## [0.2.36] - 2026-03-19

- docs: rewrite README — add philosophy, "skills over features" contributing model, "What It Supports" section
- feat: `taskmaster` skill — completion guard that prevents premature task abandonment (adapted from blader/taskmaster)
- fix: prevent silent daemon crashes — add uncaughtException/unhandledRejection handlers with PID cleanup
- feat: `nia init` now auto-installs system service (launchd/systemd) for crash auto-restart
- fix: harden `getExecCommand()` fallback when `process.argv[1]` is undefined

## [0.2.35] - 2026-03-19

- feat: `yc-office-hours` skill — YC-style product diagnostic with startup and builder modes
- feat: `remotion` skill — best practices for programmatic video creation in React
- feat: `marketing-ideas`, `pricing-strategy`, `content-strategy`, `marketing-psychology` skills
- feat: `pptx` and `docx` skills — create, read, edit PowerPoint and Word documents
- update: `frontend-design` skill — merged Anthropic's design thinking, bolder aesthetic direction

## [0.2.34] - 2026-03-19

- feat: `nia job update` CLI command and `update_job` MCP tool
- feat: `read_memory` MCP tool — agent can recall saved memories on demand
- fix: proactive memory saving — Nia now auto-saves personal facts, travel plans, corrections
- fix: better error when adding a duplicate job (actionable message instead of raw SQL error)
- fix: human-readable durations across CLI (4m 15s instead of 254795ms)

## [0.2.33] - 2026-03-19

- feat: `read_memory` MCP tool — agent can recall saved memories on demand
- fix: prompt Nia to proactively save memories (personal facts, travel plans, corrections) without being asked

## [0.2.32] - 2026-03-19

- refactor: extract skills scanning into `src/core/skills.ts` — single source of truth
- feat: `nia skills` shows source tags, supports filtering (`nia skills project`, `nia skills nia`, etc.)

## [0.2.31] - 2026-03-19

- feat: `nia update` command — installs latest version and restarts daemon
- feat: `nia health` checks actual channel connectivity (API calls), not just token presence
- feat: alive monitor runs full health checks (DB, channels, config), not just DB heartbeat
- refactor: shared health checks in `src/core/health.ts` — single source of truth for CLI and alive monitor
- fix: alive monitor logs recovery report to daemon.log, sends agent's postmortem directly

## [0.2.30] - 2026-03-19

- simplify: alive monitor triggers recovery immediately, no threshold delay
- docs: add release flow checklist to AGENTS.md

## [0.2.29] - 2026-03-19

- feat: alive monitor — DB heartbeat with auto-reconnect, LLM recovery agent, and user notification
- feat: hot-reload watch channels via config.yaml mtime (no daemon restart needed)
- feat: watch keys must use `channel_id#name` format (removed legacy name resolution)
- feat: show nia version in `nia health` output
- fix: Slack — relaxed permissions (read ops open to all), reply in-thread by default, prefer relative timestamps

## [0.2.28] - 2026-03-18

- feat: enable/disable flag for watch channels (`enabled: true|false` in config, default true)
- feat: `nia watch` CLI — list, add, remove, enable, disable watch channels
- feat: `enable_watch_channel` / `disable_watch_channel` MCP tools
- feat: prefer relative timestamps over UTC in Slack messages
- fix: move relaxed permissions to Slack-only, keep Telegram strict (owner-only)
- fix: Slack reply routing — always reply in same thread, don't DM unless in DMs
- test: add tests for config runner/watch parsing, addMemory guards, watch channel tools

## [0.2.25] - 2026-03-18

- fix: relax channel permissions — anyone can ask read operations, only owner for destructive actions
- feat: `nia validate` command to check config.yaml for errors
- feat: support `channel_id#channel_name` format for watch channels (no API call needed)
- refactor: extract CLI formatting constants (icons, colors, spinner) into shared `utils/cli.ts`
- docs: add release cadence guidance to AGENTS.md

## [0.2.22] - 2026-03-18

- feat: Slack watch channels — per-channel proactive monitoring with configurable behavior prompts
- feat: `add_watch_channel` / `remove_watch_channel` MCP tools for agent self-config
- feat: download thread attachments (images, PDFs) from prior Slack thread messages
- feat: increase Slack thread context from 20 to 50 messages
- perf: disk-backed file cache for Slack attachments with metadata (`~/.niahere/tmp/attachments/`)
- fix: preserve MIME type on cached attachment disk hits (HEIC→JPEG transcoding was lost)
- fix: exclude archived channels from watch channel resolution
- fix: consistent 300 char limit in `add_memory` tool description

## [0.2.21] - 2026-03-18

- fix: simplify `nia job list` output to one line per job
- fix: close Claude SDK query handle after job completes (prevents lingering subprocesses)
- fix: harden `add_memory` to reject log dumps, transcripts, and duplicates
- feat: add `nia rules` and `nia memory` CLI commands (show/reset)

## [0.2.20] - 2026-03-18

- feat: add Claude Agent SDK as default job runner with codex fallback (`runner: claude|codex` in config)
- feat: add gh-stamp skill for PR approval comments

## [0.2.19] - 2026-03-17

- feat: add `rules.md` and `add_rule`/`add_memory` MCP tools
- fix: handle backtick-wrapped `[NO_REPLY]` sentinel in Slack channel

## [0.2.18] - 2026-03-16

- feat: add `nia health`, `logs --channel` filter, `chat --channel` simulate
- fix: resource leaks and data safety (review findings)
- fix: observability, validation, safety improvements
- perf: start and stop channels in parallel

## [0.2.17] - 2026-03-15

- feat: add frontend-design skill, anti-AI-slop + code quality rules to prompts
- refactor: extract shared standards into mode-common prompt
- refactor: move security and permissions to channel-common prompt

## [0.2.16] - 2026-03-15

- docs: add CLAUDE.md, add test coverage expectation to AGENTS.md

## [0.2.15] - 2026-03-14

- feat: improve system prompts with Codex-inspired best practices

## [0.2.14] - 2026-03-14

- Initial public release
