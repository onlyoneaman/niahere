---
name: google-workspace-cli
description: >
  Use when user wants to interact with Google Workspace APIs (Gmail, Drive, Calendar, Sheets, Docs, Chat, Admin)
  from the command line using `gws`. Also use when setting up Google Workspace CLI, OAuth for Google APIs,
  or automating Google Workspace tasks. Check `which gws` first — if missing, offer install.
---

## Prerequisites

1. **gcloud CLI** (required for automated setup):

```bash
which gcloud || brew install google-cloud-sdk
```

2. **gws CLI**:

```bash
which gws || brew install googleworkspace-cli

# Or: npm install -g @googleworkspace/cli
```

## Setup

### Automated (requires gcloud CLI installed first)

```bash
gws auth setup
```

Creates a GCP project, enables APIs, configures OAuth, and logs you in.

### Manual

1. Create a project at [console.cloud.google.com](https://console.cloud.google.com)
2. Configure **OAuth consent screen** → External → Testing mode
3. **Add yourself as a test user** (required)
4. Create **OAuth credentials** → type **Desktop app** (not Web app)
5. Download client JSON to `~/.config/gws/client_secret.json`
6. Enable the APIs you need (Gmail, Drive, Calendar, etc.)
7. Login with only the scopes you need:

```bash
gws auth login -s gmail,drive,calendar,sheets
```

### Check auth status

```bash
gws auth status
```

## Common Gotchas

- **Subcommands are space-separated**, not dot-separated: `gws gmail users messages list` (NOT `users.messages`)
- OAuth client must be **Desktop app** type, not Web — otherwise `redirect_uri_mismatch`
- Must add yourself as **test user** in consent screen — otherwise "Access blocked"
- Testing mode apps limited to ~25 OAuth scopes — use `-s` to select only what you need
- If API not enabled, you get 403 with a direct link to enable it

## Usage

```bash
# Core syntax (space-separated subcommands)
gws <service> <resource> [sub-resource] <method> [flags]

# List Drive files
gws drive files list --params '{"pageSize": 5}'

# Gmail inbox
gws gmail users messages list --params '{"userId": "me", "maxResults": 10}'

# Get a specific email
gws gmail users messages get --params '{"userId": "me", "id": "MSG_ID", "format": "metadata", "metadataHeaders": ["Subject","From","Date"]}'

# Calendar agenda (helper command)
gws calendar +agenda

# Create calendar event
gws calendar +insert --summary "Meeting" --start 2026-04-05T10:00:00Z --end 2026-04-05T11:00:00Z --attendee user@example.com

# Send email
gws gmail +send --to user@example.com --subject "Hello" --body "Hi there"
gws gmail +send --to user@example.com --subject "Report" --body "<h1>Hi</h1>" --html --attach ./report.pdf
gws gmail +send --to user@example.com --subject "Draft" --body "Review this" --draft

# Upload to Drive
gws drive +upload ./file.pdf
gws drive +upload ./file.pdf --parent FOLDER_ID --name "Renamed.pdf"

# Read spreadsheet
gws sheets +read --spreadsheet SPREADSHEET_ID --range "Sheet1!A1:D10"

# Inspect any method's schema before calling it
gws schema drive.files.list

# Preview request without executing
gws drive files list --dry-run
```

## Key Flags

| Flag | Purpose |
|------|---------|
| `--params '<JSON>'` | URL/query parameters |
| `--json '<JSON>'` | Request body (POST/PATCH/PUT) |
| `--page-all` | Auto-paginate (NDJSON output) |
| `--page-limit <N>` | Max pages (default 10) |
| `--upload <PATH>` | File upload |
| `--output <PATH>` | Download binary files |
| `--dry-run` | Preview without executing |
| `--format <FMT>` | Output format: json (default), table, yaml, csv |

## Helper Commands

Prefixed with `+`, these are convenience wrappers. Run `gws <service> +cmd --help` for full options.

- **gmail:** `+send`, `+reply`, `+reply-all`, `+forward`, `+triage`, `+watch`
- **sheets:** `+append`, `+read`
- **docs:** `+write`
- **chat:** `+send`
- **drive:** `+upload`
- **calendar:** `+insert`, `+agenda`
- **workflow:** `+standup-report`, `+meeting-prep`, `+weekly-digest`

## Multi-Account Setup

`gws` = personal (default at `~/.config/gws/`). For additional accounts, use separate config dirs via aliases:

```bash
# One-time: set up work account
GOOGLE_WORKSPACE_CLI_CONFIG_DIR=~/.config/gws-work gws auth setup

# Add to .zshrc
alias gws-work='GOOGLE_WORKSPACE_CLI_CONFIG_DIR=~/.config/gws-work gws'
```

Then: `gws` for personal, `gws-work` for work.

## Auth Environment Variables

| Variable | Purpose |
|----------|---------|
| `GOOGLE_WORKSPACE_CLI_TOKEN` | Pre-obtained access token |
| `GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE` | Path to credentials JSON |
| `GOOGLE_WORKSPACE_CLI_CLIENT_ID` | OAuth client ID |
| `GOOGLE_WORKSPACE_CLI_CLIENT_SECRET` | OAuth client secret |
| `GOOGLE_WORKSPACE_CLI_CONFIG_DIR` | Override config dir (default `~/.config/gws`) |

## Reference

- Repo: https://github.com/googleworkspace/cli
- Credentials stored encrypted in `~/.config/gws/` (AES-256-GCM, key in OS keyring)
- Works with both personal Gmail and Google Workspace accounts (admin APIs are Workspace-only)
- Exit codes: 0 success, 1 API error, 2 auth error, 3 validation, 4 discovery, 5 internal
