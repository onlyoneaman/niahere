---
name: render-cli
description: >
  Render CLI for deploying and managing services, databases, and blueprints on Render.
  Use when user mentions render, deploying to render, render services, or render databases.
  Check `which render` first — if missing, offer: `brew install render` (macOS) or curl installer.
  Covers deploys, services, SSH, psql, blueprints, and CI workflows.
---

## Prerequisites

Before any render command, verify the CLI is available:

```bash
which render
```

**If not found**, ask the user:

> Render CLI not found. Install it?
>
> macOS:
> ```bash
> brew install render
> ```
>
> Linux/macOS (alternative):
> ```bash
> curl -fsSL https://raw.githubusercontent.com/render-oss/cli/refs/heads/main/bin/install.sh | sh
> ```

After install, authenticate:

```bash
render login
```

Then set the active workspace:

```bash
render workspace set
```

**If found but not authed**, `render services` will fail — run `render login`.

## Core Commands

| Command | Purpose |
|---------|---------|
| `render services` | List services and datastores |
| `render deploys create <id>` | Trigger a deploy |
| `render deploys list <id>` | Deploy history |
| `render ssh <id>` | SSH into a service |
| `render psql <id>` | Postgres session |
| `render blueprints validate` | Validate render.yaml |
| `render workspaces` | List workspaces |

## Workflows

### First-time setup
```bash
brew install render   # or curl installer
render login
render workspace set
render services       # verify access
```

### Deploy a service
```bash
render services                          # pick service
render deploys create <SERVICE_ID>       # trigger deploy
render deploys create <ID> --wait        # block until done
render deploys create <ID> --commit <SHA>  # specific commit
render deploys create <ID> --image <URL>   # docker image
```

### Database access
```bash
render psql <DATABASE_ID>                    # interactive session
render psql <DATABASE_ID> -c "SELECT 1"      # one-shot query
render psql <DATABASE_ID> -o json            # JSON output
```

### Debug a service
```bash
render ssh <SERVICE_ID>                  # interactive shell
render ssh <SERVICE_ID> --ephemeral      # throwaway shell
```

### Validate blueprints
```bash
render blueprints validate               # defaults to ./render.yaml
render blueprints validate my-render.yaml
```

## CI / Non-Interactive Mode

Use `RENDER_API_KEY` (not login tokens) for automation:

```bash
RENDER_API_KEY=$RENDER_API_KEY render deploys create "$SERVICE_ID" --output json --confirm
```

- `--confirm` skips prompts
- `--output` / `-o`: `json`, `yaml`, `text`, `interactive`
- `RENDER_OUTPUT` env var sets default output format

## Config

- Config path: `~/.render/cli.yaml`
- Override: `RENDER_CLI_CONFIG_PATH` env var
- Re-auth: `render login` if token expires

## Decision Points

- User says "deploy to render" → `render deploys create`
- User says "check render services" → `render services`
- User needs DB access → `render psql`
- User needs shell access → `render ssh`
- User has render.yaml → `render blueprints validate`
- render not installed → offer install, don't silently fail
- render not authed → run `render login`

## References

- Docs: https://render.com/docs/cli
- Releases: https://github.com/render-oss/cli/releases
- Source: https://github.com/render-oss/cli
