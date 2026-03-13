# nia

A personal AI assistant that runs as a background daemon. Handles scheduled jobs, terminal chat, and Telegram — powered by Claude.

- npm package: [`niahere`](https://www.npmjs.com/package/niahere)
- CLI command: `nia`

## Quick Start

```bash
bun install -g niahere
nia init          # guided setup (database, telegram, persona)
nia start         # starts daemon + registers OS service
```

## Commands

```
nia init                       — interactive setup (db, telegram, persona)
nia start / stop               — daemon + OS service (launchd/systemd)
nia restart                    — restart daemon
nia status                     — show daemon, jobs, channels, chat rooms
nia chat [-r|--resume]         — interactive terminal chat
nia run <prompt>               — one-shot prompt execution
nia history [room]             — recent messages
nia logs [-f]                  — daemon logs (follow with -f)
nia send <message>             — send a message via Telegram
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
nia job import                 — import YAML jobs from jobs/ dir
```

## Features

- **Jobs & crons** — jobs run during active hours, crons run 24/7. Stored in PostgreSQL, auto-reload via LISTEN/NOTIFY.
- **Terminal chat** — REPL with session resume support
- **Telegram** — bot with access control, streaming responses, rich activity status (shows thinking, tool use, commands)
- **Persona system** — customizable identity, soul, owner profile, and auto-memory
- **Cross-platform service** — launchd (macOS), systemd (Linux), or plain daemon
- **Skills** — loads user skills from `~/.shared/skills/`, `~/.claude/skills/`, `~/.codex/skills/`

## Architecture

All config and data lives in `~/.niahere/`:

```
~/.niahere/
  config.yaml       — database, telegram, model, timezone, active hours, log level
  self/
    identity.md     — agent personality and voice
    owner.md        — who runs this agent
    soul.md         — operating principles and rules
    memory.md       — auto-maintained learnings
  tmp/
    nia.pid, daemon.log, cron-state.json, cron-audit.jsonl
```

## Requirements

- [Bun](https://bun.sh) runtime
- PostgreSQL database
- Claude API access (via `@anthropic-ai/claude-agent-sdk`)

## Author

Aman ([amankumar.ai](https://amankumar.ai))
