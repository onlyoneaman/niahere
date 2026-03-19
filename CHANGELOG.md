# Changelog

## [Unreleased]

- feat: `yc-office-hours` skill — YC-style product diagnostic with startup and builder modes
- feat: `remotion` skill — best practices for programmatic video creation in React
- update: `frontend-design` skill — merged Anthropic's design thinking, bolder aesthetic direction, motion/backgrounds sections
- feat: `marketing-ideas` skill — 139 proven marketing ideas by category, stage, budget
- feat: `pricing-strategy` skill — value-based pricing, tier structure, research methods
- feat: `content-strategy` skill — searchable vs shareable content, topic clusters, ideation
- feat: `marketing-psychology` skill — thinking models, buyer psychology, persuasion, pricing psychology
- feat: `pptx` skill — create, read, edit PowerPoint presentations
- feat: `docx` skill — create, read, edit Word documents with docx-js

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
