---
name: modal-cli
description: >
  Modal CLI for serverless GPU/cloud compute. Use when user mentions modal, deploying to modal,
  running GPU workloads, or serverless Python functions.
  Check `which modal` first — if missing, offer: `pip install modal && modal setup`.
  Covers run/serve/deploy, apps, containers, secrets, volumes, and workspace management.
---

## Prerequisites

Before any modal command, verify the CLI is available:

```bash
which modal
```

**If not found**, ask the user:

> Modal CLI not found. Install it?
>
> ```bash
> pip install modal
> ```

After install, run auth setup:

```bash
modal setup
```

This opens a browser for token auth. If `modal` still isn't on PATH after pip install, use:

```bash
python -m modal setup
```

**If found but not authed**, check with:

```bash
modal token info
```

If that errors, run `modal setup` to authenticate.

## Core Commands

| Command | Purpose |
|---------|---------|
| `modal run <file>` | One-off execution of a script/function |
| `modal serve <file>` | Local dev with hot-reload |
| `modal deploy <file>` | Production deployment |
| `modal app list` | List deployed apps |
| `modal app logs <name>` | Stream logs for a deployed app |
| `modal app stop <name>` | Stop a running app |
| `modal shell` | Interactive shell in Modal environment |

## Workflows

### First-time setup
```bash
pip install modal
modal setup
modal run hello.py  # validate end-to-end
```

### Develop and deploy
```bash
modal run my_app.py        # test locally
modal serve my_app.py      # hot-reload dev
modal deploy my_app.py     # ship it
```

### Debug containers
```bash
modal container list
modal container logs <id>
modal container exec <id> -- bash -lc "nvidia-smi"
```

### Manage resources
```bash
modal secret create my-secret KEY=value
modal volume create my-vol
modal environment create dev
modal config set-environment dev
```

## Auth & Profiles

- `modal token info` — check current auth
- `modal token new` — create token via browser
- `modal token set` — set token credentials directly
- `modal profile list` / `activate` — switch workspaces
- `modal config show` — print effective config

Environment variables: `MODAL_TOKEN_ID`, `MODAL_TOKEN_SECRET`, `MODAL_ENVIRONMENT`, `MODAL_PROFILE`

## Resource Management

- **Secrets**: `modal secret list/create/delete` (supports `.env` import)
- **Volumes**: `modal volume create/list/ls/put/get/rm/delete`
- **Dicts**: `modal dict create/list/items/get/clear/delete`
- **Queues**: `modal queue create/list/peek/len/clear/delete`
- **NFS**: `modal nfs list/create/ls/put/get/rm/delete`
- **Environments**: `modal environment list/create/delete/update`

## Decision Points

- User says "deploy to modal" / "run on GPU" → `modal deploy` or `modal run`
- User says "check my modal apps" → `modal app list`
- User says "modal logs" → `modal app logs <name>`
- User needs interactive debug → `modal shell` or `modal container exec`
- modal not installed → offer install, don't silently fail
- modal not authed → run `modal setup`

## References

- Guide: https://modal.com/docs/guide
- CLI reference: https://modal.com/docs/reference/cli/
- Status: https://status.modal.com
