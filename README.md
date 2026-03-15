# nia

A personal AI assistant that runs as a background daemon. Handles scheduled jobs, terminal chat, Telegram, and Slack — powered by Claude.

- npm package: [`niahere`](https://www.npmjs.com/package/niahere)
- CLI command: `nia`
- Website: [niahere.com](https://niahere.com)

## Quick Start

```bash
bun install -g niahere
nia init          # guided setup (database, channels, persona, visual identity)
nia start         # starts daemon + registers OS service
```

## Commands

```
nia init                       — interactive setup (db, channels, persona, images)
nia start / stop               — daemon + OS service (launchd/systemd)
nia restart                    — restart daemon
nia status                     — show daemon, jobs, channels, chat rooms
nia chat [-r|--resume]         — interactive terminal chat
nia run <prompt>               — one-shot prompt execution
nia history [room]             — recent messages
nia logs [-f]                  — daemon logs (follow with -f)
nia send <message>             — send a message via configured channel
nia skills                     — list available skills
nia test [-v]                  — run tests
nia version                    — show version

nia job list                   — list all jobs
nia job show [name]            — full details + recent runs
nia job status [name]          — quick status check
nia job add <n> <s> <p>        — add a job (active hours only)
nia job add <n> <s> <p> --always — add a cron (runs 24/7)
nia job remove <name>          — delete a job
nia job enable / disable <n>   — toggle a job
nia job run <name>             — run a job once
nia job log [name]             — show recent run history
nia channels                   — show channel status (on/off)
nia channels on / off          — enable/disable channels
```

## Features

- **Jobs & crons** — jobs run during active hours, crons run 24/7. Stored in PostgreSQL, auto-reload via LISTEN/NOTIFY. Full JSONL traces stored per run with Codex session IDs for inspection.
- **Terminal chat** — REPL with session resume support
- **Telegram** — bot with access control, typing indicator while processing, no placeholder messages
- **Slack** — Socket Mode bot with thinking emoji reactions, thread awareness (auto-listens to follow-ups without @mention), thread context fetching
- **Persona system** — customizable identity, soul, owner profile, and on-demand memory
- **Visual identity** — AI-generated profile pictures via Gemini, customizable during `nia init`
- **Cross-platform service** — launchd (macOS), systemd (Linux), or plain daemon
- **Skills** — loads user skills from `~/.shared/skills/`, `~/.claude/skills/`, `~/.codex/skills/`, and bundled skills

## Architecture

All config and data lives in `~/.niahere/`:

```
~/.niahere/
  config.yaml       — database, channels, model, timezone, active hours, gemini key
  self/
    identity.md     — agent personality and voice
    owner.md        — who runs this agent
    soul.md         — how the agent works
    memory.md       — persistent learnings (read/written on demand, not loaded into context)
  images/
    reference.png   — visual identity reference image
    profile.png     — profile picture for Telegram/Slack
  tmp/
    nia.pid, daemon.log, cron-state.json, cron-audit.jsonl
```

## Requirements

- [Bun](https://bun.sh) runtime
- PostgreSQL database
- Claude API access (via `@anthropic-ai/claude-agent-sdk`)
- Gemini API key (optional, for image generation)

## Author

Aman ([amankumar.ai](https://amankumar.ai))
