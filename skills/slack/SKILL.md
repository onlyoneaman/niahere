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

## Beyond these primitives

These commands cover common operations but the Slack API has 200+ methods. If you need something not listed here (e.g. managing bookmarks, setting channel topics, pinning messages, scheduling messages, managing user groups):

1. **Check `slack.py --help`** for available subcommands first.
2. **Use the Slack API directly** via `curl` with the bot token from `slack_helper.load_slack_config()["token"]`. The pattern is always: `curl -H "Authorization: Bearer $TOKEN" https://slack.com/api/<method>`.
3. **Consult the [Slack API docs](https://api.slack.com/methods)** to find the right method and required scopes.
4. **Compose primitives** to build workflows — "summarize channel" is just `history` + LLM reasoning. "Find discussions about X" is `search` + `thread`.

The bot token and auth pattern are consistent across all Slack APIs. Don't limit yourself to what's explicitly in `slack.py` — treat it as a starting point, not a boundary.

## Design

Each subcommand = one Slack API call. No bundled workflows.
Features are outcomes achieved by an agent composing these primitives in a loop.
