---
name: slack
description: Atomic Slack primitives for agents. Send, reply, DM, read history, threads, list channels/users, search, react. Use when you need to interact with Slack.
---

# Slack — Atomic Primitives

Single entry point, one subcommand per API call. Agents compose these to build any Slack workflow.

## Setup

Credentials: `~/.niahere/config.yaml` → `channels.slack.bot_token`

## Primitives

```bash
S=~/.shared/skills/slack/slack.py

# Send & reply
python3 $S send      --channel C... --text "message"
python3 $S reply     --channel C... --thread-ts 1... --text "reply"
python3 $S dm        --text "message"                          # DMs dm_user_id
python3 $S dm        --text "message" --user U...              # DMs specific user

# Read
python3 $S history   --channel C... [--limit 20]
python3 $S thread    --channel C... --thread-ts 1... [--limit 50]

# Discovery
python3 $S channels  [--limit 200]
python3 $S users     [--limit 200]
python3 $S user-info --user U...
python3 $S search    --query "text" [--limit 10]
python3 $S identity

# React
python3 $S react     --channel C... --ts 1... --emoji thumbsup
```

## Extracting Thread Info from Slack URL

URL format: `https://<workspace>.slack.com/archives/<CHANNEL_ID>/p<THREAD_TS_NO_DOT>`
- **Channel ID:** the segment after `/archives/`
- **Thread TS:** the `p` number with a `.` inserted before the last 6 digits

## Design

Each subcommand = one Slack API call. No bundled workflows.
Features like "summarize channel" or "find discussions" are agent-level compositions of these primitives.
