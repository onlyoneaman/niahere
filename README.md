# nia

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
- **Scheduled jobs** — recurring jobs and crons that run Claude and can message you back
- **Persona system** — customizable identity, soul, owner profile, and on-demand memory
- **Agents** — domain specialists (marketer, senior-dev) via Claude Agent SDK subagents
- **Skills** — loads skills from multiple directories, invokable as slash commands
- **Cross-platform service** — launchd (macOS), systemd (Linux), service-aware restart
- **MCP tools** — 18 tools for job management, messaging, memory, and channel control
- **Optional integrations** — add Gmail, Discord, and more via skills

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
nia job add <n> <s> <p> --agent <name> — add a job using an agent
nia job add <n> <s> <p> --always — add a cron (runs 24/7)
nia job remove <name>          — delete a job
nia job enable / disable <n>   — toggle a job
nia job run <name>             — run a job once
nia job log [name]             — show recent run history

nia agent list                 — list available agents
nia agent show <name>          — show agent details and prompt

nia db setup                   — install PostgreSQL + create database + migrate
nia db migrate                 — run database migrations
nia db status                  — check database connection

nia config list                — show all config
nia config get <key>           — get a config value (dot notation supported)
nia config set <key> <value>   — set a config value

nia channels                   — show channel status (on/off)
nia channels on / off          — enable/disable channels
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
npm i -g niahere         # pulls the latest version from npm
```

## Author

Aman ([amankumar.ai](https://amankumar.ai))
