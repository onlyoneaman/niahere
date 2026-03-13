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
nia init                — interactive setup
nia start / stop        — daemon + OS service (launchd/systemd)
nia restart             — restart daemon
nia status              — show daemon, jobs, channels, chat rooms
nia chat [-r|--resume]  — interactive terminal chat
nia run <prompt>        — one-shot prompt execution
nia history [room]      — recent messages
nia logs [-f]           — daemon logs (follow with -f)
nia job list            — list all jobs
nia job add <n> <s> <p> — add a job (name, cron schedule, prompt)
nia job remove <name>   — delete a job
nia job enable <name>   — enable a job
nia job disable <name>  — disable a job
nia job run <name>      — run a job once
nia job import          — import YAML jobs from jobs/ dir
nia skills              — list available skills
nia telegram <token>    — configure Telegram bot
```

## Features

- **Scheduled jobs** — cron-based, stored in PostgreSQL, auto-reload via LISTEN/NOTIFY
- **Terminal chat** — REPL with session resume support
- **Telegram** — bot integration for remote chat
- **Persona system** — customizable identity, soul, owner profile, and auto-memory
- **Cross-platform service** — launchd (macOS), systemd (Linux), or plain daemon
- **Skills** — loads user skills from `~/.shared/skills/`, `~/.claude/skills/`, `~/.codex/skills/`

## Architecture

All config and data lives in `~/.niahere/`:

```
~/.niahere/
  config.yaml       — database, telegram, model, timezone, log level
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
