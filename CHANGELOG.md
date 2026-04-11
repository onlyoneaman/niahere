# Changelog

## [Unreleased]

### Changed

- **Environment system prompt updated for recent releases.** `src/prompts/environment.md` had drifted behind several shipped features: (1) the `update_job` and `add_job` bullets now mention the `model` override from 0.2.59; (2) the `channels.slack.watch` config reference now describes the dir-per-watch layout and the three forms of the optional `behavior` field from 0.2.61; (3) the Persona & Memory section now includes `staging.md` in the persona files list and has a new "How durable memories get made" subsection that describes the two-stage flow (live user-explicit saves vs background consolidation via staging → nightly promoter); (4) the old "When to save (be proactive)" section with two large affirmative tables (16 rows total) has been trimmed to a single 4-row "When to save live" table plus an explicit "let the consolidator handle it" paragraph. The live agent now has a narrower save bar on purpose — the background consolidator catches what the live pass skips, so aggressive proactive saving is no longer necessary.
- Also fixed a markdown linter corruption in the `add_job` cron example (asterisks were getting escaped into italic markers).

## [0.2.62] - 2026-04-11

### Changed

- **Two-stage memory architecture** — replaced the direct-write memory consolidator with a staging pipeline. After a chat session goes idle, the consolidator now reflects on the transcript and appends candidate lines to a new `~/.niahere/self/staging.md` file (format: `- [count×] [type] content :: first_seen → last_seen`, types: `persona | project | reference | correction`). Reinforcement happens in-place — seeing a candidate again bumps `[1×] → [2×]`. A new auto-installed system job `memory-promoter` runs nightly at 3am, reaps entries older than 14 days with count<2, and promotes qualifying candidates (`count ≥ 2` + durability review) to `memory.md` or `rules.md`. This replaces the old single-pass consolidator that was producing low-precision, low-recall memories (saving transient incidents as durable facts while missing real patterns).
- **Job runs no longer flow through the global memory consolidator.** `consolidateJobRun` has been removed. Job-local learnings stay in each job's `state.md` (via `buildWorkingMemory()`), which is the existing per-job working memory that already gets injected into the next run's prompt. Routing job output through global persona memory was a layer violation that caused transient job incidents to get promoted to durable facts.
- **Consolidator prompt rewritten around reflection, not extraction.** The old prompt listed 5 fact categories and asked the agent to fish for matches. The new prompt asks three reflection questions ("what did the user correct / what new fact do you know / what decision was made") and defaults to doing nothing. It explicitly overrides the "save proactively" framing in `environment.md`, which is correct for live chat but was leaking into the consolidator and biasing it toward saving trivial observations.

### Added

- **`userinterface-wiki` skill** — imported the 152-rule UI/UX best-practices reference (animation timing, easing, springs, exit animations, CSS pseudo-elements, audio, morphing icons, container animation, Laws of UX, prefetching, typography, visual design). Wired it in as a companion reference from `frontend-design`, `code-review`, `qa`, and `cro` so reviewers and builders can cite specific rule IDs (e.g. `timing-under-300ms`, `ux-fitts-target-size`, `visual-concentric-radius`) instead of vague "feels off" feedback.

### Fixed

- **`nia validate` rejected watches without inline behavior** — validator was still enforcing the old required-behavior rule after the dir-per-watch rework. Now accepts watches with no `behavior` field and labels them `[file (default)]` in the output.

## [0.2.61] - 2026-04-11

### Added

- **Dir-per-watch layout + optional behavior** — each Slack watch is now a self-contained directory at `~/.niahere/watches/<name>/` (matching the agents pattern). The `behavior` field in `channels.slack.watch` is now optional: omit it and the watch loads `watches/<name>/behavior.md` using the channel name from the config key. Set it to a single word to override the directory, or to prose for an inline behavior. Short behaviors still work inline. Missing files no longer break the watch — agent just runs without explicit behavior. Hot-reloads via mtime tracking of config.yaml AND any referenced behavior files. Auto-creates `watches/` dir on daemon startup and `nia init`.

### Improved

- **Unified session finalizer** — consolidated ad-hoc consolidation/summarization calls into a single DB-backed finalizer queue (`finalization_requests` table). REPL and CLI exits are now instant — the daemon processes post-session work reliably via `pg_notify`. Fixes `CONNECTION_ENDED` errors on `nia chat` exit.

## [0.2.60] - 2026-04-09

### Improved

- **CLAUDE.md prompt hardening** — added banned filler phrases list, web search guidelines with data freshness tiers (volatile/recent/stable), user-override-defaults principle, and tighter communication style rules (lead with answer, no hedging). Inspired by competitive prompt analysis.
- **Skills consolidation** — merged 20+ standalone skills into router skills. Cold email + email sequence → `email`, AI SEO + SEO audit + llms.txt → `seo`, page/signup/onboarding CRO → `cro`, social content + marketing ideas + marketing psychology + launch strategy + competitor alternatives + pricing strategy → `marketing`, copy editing → `copywriting`, minimalist review → `plan-review`, pr-reviewer → `code-review`. Removed docx, pptx, and gh-stamp standalone skills. Slimmed down content-strategy, copywriting, frontend-design, customer-research, and agent-skill-creator. Net: ~12,400 lines removed across 59 files.

## [0.2.59] - 2026-04-09

### Added

- **Per-job model override** — jobs can now specify a model (`--model haiku`, `--model sonnet`) that overrides the agent model and global config. Enables cost savings by routing simple jobs to cheaper models. Priority: job model > agent model > config model. Supports CLI (`nia job add/update --model <model>`) and MCP tools.
- **SDK upgrade to v0.2.97** — bumped from v0.2.74. Adds `terminal_reason` to job and chat results, showing exactly why an agent stopped (`completed`, `max_turns`, `aborted_tools`, `hook_stopped`, etc.). Surfaced in `nia job run` output, audit logs, and message metadata.
- **Beads-tasks skill expanded** — added core commands reference, workflow examples, and query/filter patterns

### Fixed

- **`nia job run` and `nia run` hang after completion** — background consolidation kept the event loop alive, preventing the process from exiting. Both commands now exit immediately after printing results.

## [0.2.58] - 2026-04-09

### Added

- **Optimization loop skill** — the Karpathy Loop / autoresearch pattern as a reusable skill. Covers the full discipline: frozen contract + rubric, pairwise scoring with anti-bias controls, staged exploration strategy, workspace layout, results audit trail (JSONL), resumability, and scoring integrity rules. Domain-agnostic — works for code benchmarks, prompt quality, copy effectiveness, or any scorable target.
- **Optimize skill** — orchestration layer for scheduling optimization runs. Handles proactive suggestions after immediate work, spec confirmation with user, job prompt composition, one-shot job scheduling, and result delivery. References optimization-loop for the loop discipline.

### Tests

- **Scheduler integration tests** — one-shot auto-disable, `listDue` filtering (enabled + due only), `markRun` advancing `next_run_at`, invalid schedule error handling
- **Active engine tracking tests** — verifies `list()` no longer deletes stale entries, register upsert, `ping()` updates, `clearAll`
- **Test DB auto-creation** — shared `tests/db/setup.ts` creates `niahere_test` database automatically on first run

### Fixed

- **Multi-turn user messages not persisted** — in live chat sessions, only the first user message was saved to the database. Subsequent messages in the same session were lost, corrupting history, search, summaries, and memory consolidation. Now saved in `send()` before pushing to the stream.
- **Active-engine tracking broken for long tasks** — `list()` silently deleted entries older than 5 minutes via `clearStale()`, causing long-running chats and jobs to vanish from tracking and get terminated during shutdown. Removed mutation from `list()`.
- **Consolidation/summarization one-shot forever** — a process-global `Set` permanently marked sessions as processed, preventing re-consolidation when sessions got new turns. Replaced with a bounded `Map` (sessionId → message count) that re-processes when new messages arrive. Capped at 500 entries to prevent memory leaks. Transient failures are now retried.
- **DB tests hit real database** — `tests/db/` used the production database. Now auto-creates a `niahere_test` database and points all test config at it.
- **Backup exposed DB credentials via `ps`** — `pg_dump` was called with the full postgres URL as a CLI arg. Now parses the URL and passes the password via `PGPASSWORD` env var.
- **Case-sensitive skill/agent dedup** — skills and agents with differently-cased names (e.g., `Optimization-Loop` vs `optimization-loop`) could appear twice in the list. Dedup is now case-insensitive.
- **False "telegram: unreachable" alerts** — health check fetches to Telegram and Slack now retry 3 times with Fibonacci backoff (1s, 1s, 2s) and a 5s timeout per attempt. Transient network blips (macOS sleep, DNS hiccups) no longer trigger the LLM recovery agent. Unreachable channels report `warn` instead of `fail`, reserving `fail` for real auth errors.

## [0.2.57] - 2026-04-07

### Added

- **Job working memory** — jobs are now stateful by default. Each job gets a persistent workspace at `~/.niahere/jobs/<name>/` with a `state.md` file that is automatically injected into the prompt on each run. The agent updates it at the end of each run with what it did, what it noticed, and what to focus on next. Jobs can opt out with `--stateless yes`. Supports CLI (`nia job add/update --stateless yes|no`) and MCP tools.

## [0.2.56] - 2026-04-07

### Added

- **AWS CLI skill** — reference guide for AWS CLI usage, auth troubleshooting (default profile vs SSO), and common commands for S3, DynamoDB, CloudWatch, Lambda, STS, IAM. Includes Kay-specific context (account, buckets, tables, region).

### Fixed

- **Slack image messages silently dropped** — messages with image/file attachments have `subtype: "file_share"` which was caught by a blanket `if (message.subtype) return` guard. The full image pipeline (download, resize, base64, vision) was already built but never reached. Now allows `file_share` through.

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
