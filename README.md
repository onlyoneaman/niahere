# nia

A personal AI assistant that runs as a background daemon. Handles scheduled jobs, terminal chat, Telegram, and Slack — powered by Claude.

- npm package: [`niahere`](https://www.npmjs.com/package/niahere)
- CLI command: `nia`
- Website: [niahere.com](https://niahere.com)

## Quick Start

```bash
npm i -g niahere        # installs globally (prompts to install Bun if missing)
nia init                # guided setup (database, channels, persona, visual identity)
nia start               # starts daemon + registers OS service
```

## Commands

```
nia init                       — interactive setup (db, channels, persona, images)
nia start / stop               — daemon + OS service (launchd/systemd)
nia restart                    — restart daemon (service-aware)
nia status                     — show daemon, jobs, channels, chat rooms
nia chat [-r|--resume]         — interactive terminal chat
nia run <prompt>               — one-shot prompt execution
nia history [room]             — recent messages
nia logs [-f]                  — daemon logs (follow with -f)
nia send [-c channel] <msg>    — send a message via channel
nia skills                     — list available skills
nia version                    — show version

nia job list                   — list all jobs
nia job show [name]            — full details + recent runs
nia job add <n> <s> <p>        — add a job (active hours only)
nia job add <n> <s> <p> --always — add a cron (runs 24/7)
nia job remove <name>          — delete a job
nia job enable / disable <n>   — toggle a job
nia job run <name>             — run a job once
nia job log [name]             — show recent run history

nia db setup                   — install PostgreSQL + create database + migrate
nia db migrate                 — run database migrations
nia db status                  — check database connection

nia config list                — show all config
nia config get <key>           — get a config value (dot notation supported)
nia config set <key> <value>   — set a config value

nia channels                   — show channel status (on/off)
nia channels on / off          — enable/disable channels
```

## Features

- **Jobs & crons** — jobs run during active hours, crons run 24/7. Stored in PostgreSQL, auto-reload via LISTEN/NOTIFY. One-shot jobs auto-disable after execution. Full JSONL traces with Codex session IDs.
- **Terminal chat** — REPL with session resume support
- **Telegram** — bot with access control, typing indicator while processing
- **Slack** — Socket Mode bot with thinking emoji reactions, thread awareness (auto-listens to follow-ups without @mention), thread context fetching, owner vs non-owner access control, prompt injection defense
- **Persona system** — customizable identity, soul, owner profile, and on-demand memory
- **Visual identity** — AI-generated profile pictures via Gemini, customizable during `nia init`
- **Cross-platform service** — launchd (macOS), systemd (Linux), service-aware restart
- **Skills** — loads skills from `~/.shared/skills/`, `~/.claude/skills/`, `~/.codex/skills/`, and bundled skills
- **Dev mode** — `nia channels off` disables Telegram/Slack for local development without conflicts

## Updating

```bash
npm i -g niahere         # pulls the latest version from npm
```

To publish a new version after making changes:

```bash
npm run release          # bumps patch version, publishes to npm, pushes git tag
```

## Architecture

All config and data lives in `~/.niahere/`:

```
~/.niahere/
  config.yaml       — database, channels, model, timezone, active hours, API keys
  self/
    identity.md     — agent personality and voice
    owner.md        — who runs this agent
    soul.md         — how the agent works
    memory.md       — persistent learnings (read/written on demand)
  images/
    reference.webp  — visual identity reference image
    profile.webp    — profile picture for Telegram/Slack
  tmp/
    nia.pid, daemon.log, cron-state.json, cron-audit.jsonl
```

## Requirements

- [Bun](https://bun.sh) runtime (auto-installed if missing)
- PostgreSQL (`nia db setup` handles installation)
- Claude API access (via `@anthropic-ai/claude-agent-sdk`)
- Gemini API key (optional, for image generation — `nia config set gemini_api_key ...`)
- OpenAI API key (optional, for image generation — `nia config set openai_api_key ...`)

## Author

Aman ([amankumar.ai](https://amankumar.ai))
