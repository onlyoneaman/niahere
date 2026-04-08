# nia

[![npm version](https://img.shields.io/npm/v/niahere.svg)](https://www.npmjs.com/package/niahere)
[![npm downloads](https://img.shields.io/npm/dm/niahere.svg)](https://www.npmjs.com/package/niahere)
[![license](https://img.shields.io/npm/l/niahere.svg)](https://github.com/onlyoneaman/niahere/blob/main/LICENSE)

A personal AI agent you fork and make your own. Small enough to understand, built for one user. Powered by Claude Agent SDK.

- npm package: [`niahere`](https://www.npmjs.com/package/niahere)
- CLI command: `nia`
- Website: [niahere.com](https://niahere.com)

## Philosophy

**Small enough to understand.** One process, a few source files. No microservices, no message queues, no abstraction layers. Have Claude Code walk you through it.

**Built for one user.** This isn't a framework. It's working software that fits your exact needs. You fork it and have Claude Code make it match your exact needs.

**Customization = code changes.** No configuration sprawl. Want different behavior? Modify the code. The codebase is small enough that this is safe.

**AI-native.** No installation wizard; Claude Code guides setup. No monitoring dashboard; ask Claude what's happening. No debugging tools; describe the problem, Claude fixes it.

**Skills over features.** Contributors shouldn't add features to the codebase. Instead, they contribute claude code skills like `/add-discord` that transform your fork. You end up with clean code that does exactly what you need.

**Best harness, best model.** This runs on Claude Agent SDK, which means you're running Claude Code directly. The harness matters. A bad harness makes even smart models seem dumb, a good harness gives them superpowers.

## Quick Start

```bash
npm i -g niahere        # installs globally (prompts to install Bun if missing)
nia init                # guided setup (database, channels, persona, visual identity)
nia start               # starts daemon + registers OS service
```

## What It Supports

- **Telegram** — message your agent from your phone, typing indicator while processing
- **Slack** — Socket Mode bot with thread awareness, thinking emoji, watch channels for proactive monitoring
- **Terminal chat** — REPL with session resume support
- **Scheduled jobs** — recurring jobs and crons that run Claude and can message you back. Stateful by default (working memory), per-job model routing for cost savings
- **Persona system** — customizable identity, soul, owner profile, rules, and memory (preloaded every session)
- **Agents** — domain specialists (marketer, senior-dev) via Claude Agent SDK subagents
- **Skills** — loads skills from multiple directories, invokable as slash commands
- **Cross-platform service** — launchd (macOS), systemd (Linux), service-aware restart
- **MCP tools** — 20 tools for job management, messaging, memory, rules, and channel control
- **Background memory consolidation** — extracts memories from conversations and job runs automatically
- **Session summaries** — handoff notes between sessions for continuity
- **Backups** — `nia backup` with auto-backup before updates
- **Optional integrations** — add Gmail, Discord, and more via skills

## Commands

```
nia init                       — interactive setup (db, channels, persona, agents, active hours)
nia start / stop               — daemon + OS service (launchd/systemd)
nia restart                    — restart daemon (service-aware)
nia status                     — show daemon, jobs, channels, chat rooms
nia health                     — check daemon, db, channels, config
nia chat [-c|-r] [--channel ch] — terminal chat (new by default, -c continue, -r pick)
nia run <prompt>               — one-shot prompt execution
nia history [room]             — recent messages
nia logs [-f] [--channel ch]   — daemon logs (follow with -f, filter by channel)
nia send [-c channel] <msg>    — send a message via channel
nia version                    — show version
nia update                     — update to latest version (auto-backup + restart)

nia job list                   — list all jobs
nia job show [name]            — full details + recent runs
nia job status [name]          — quick status check
nia job add <n> <s> <p>        — add a job (--type, --always, --agent, --model, --stateless, --prompt-file)
nia job update <name>          — update a job (--schedule, --prompt, --prompt-file, --type, --always, --agent, --model, --stateless)
nia job remove <name>          — delete a job
nia job enable / disable <n>   — toggle a job
nia job run <name>             — run a job once
nia job log [name]             — show recent run history

nia rules [show|reset]         — view or reset rules.md
nia memory [show|reset]        — view or reset memory.md
nia agent list                 — list available agents
nia agent show <name>          — show agent details and prompt
nia skills [source]            — list available skills

nia channels                   — show channel status (on/off)
nia channels on / off          — enable/disable channels (applied via SIGHUP, no restart)
nia watch list                 — list Slack watch channels
nia watch add/remove/enable/disable — manage watch channels

nia config list                — show all config
nia config get <key>           — get a config value (dot notation supported)
nia config set <key> <value>   — set a config value
nia validate                   — validate config.yaml
nia backup [list]              — create or list backups
nia test [-v]                  — run tests

nia db setup                   — install PostgreSQL + create database + migrate
nia db migrate                 — run database migrations
nia db status                  — check database connection
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
    rules.md        — behavioral instructions (loaded every session)
    memory.md       — persistent facts and context (loaded every session)
  jobs/               — per-job working memory and state (auto-created)
  optimizations/      — optimization loop run workspaces
  images/
    reference.webp  — visual identity reference image
    profile.webp    — profile picture for Telegram/Slack
  tmp/
    nia.pid, daemon.log, cron-state.json, cron-audit.jsonl
```

## Contributing

**Don't add features. Add skills.**

If you want to add Discord support, don't create a PR that adds Discord alongside Telegram. Instead, contribute a skill folder (`skills/add-discord/SKILL.md`) that teaches Claude Code how to transform a nia installation to use Discord.

Users then run `/add-discord` on their fork and get clean code that does exactly what they need, not a bloated system trying to support every use case.

## Requirements

- [Bun](https://bun.sh) runtime (auto-installed if missing)
- PostgreSQL (`nia db setup` handles installation)
- Claude API access (via `@anthropic-ai/claude-agent-sdk`)
- Gemini API key (optional, for image generation — `nia config set gemini_api_key ...`)
- OpenAI API key (optional, for image generation — `nia config set openai_api_key ...`)

## Updating

```bash
nia update               # auto-backup, install latest, restart daemon
```

## Author

Aman ([amankumar.ai](https://amankumar.ai))
