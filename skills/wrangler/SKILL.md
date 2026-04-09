---
name: wrangler
description: Use this skill for Cloudflare Wrangler CLI usage, project setup, development, deployment, secrets, observability, pages/R2/Queues/D1 workflows, and CI/CD authentication. Trigger for `wrangler` command guidance and official command references.
---

# Wrangler CLI

Use this skill when a user asks how to use Cloudflare’s `wrangler` CLI.

## Install and verify

1. Install/upgrade:

```bash
npm i -D wrangler@latest
npm exec wrangler --version
```

2. Quick run:

```bash
npm exec wrangler --help
npm exec wrangler whoami
```

3. Authenticate:

```bash
npm exec wrangler login
```

## Core command groups

### Workers source and lifecycle

- `wrangler init [name]`
  - scaffold Workers project files.
- `wrangler dev`
  - run a local dev server for a worker.
  - useful with `--local`/remote modes depending on runtime needs.
- `wrangler deploy`
  - deploy the current worker.
  - use `--env` to target named environments.
- `wrangler rollback`
  - revert a specific worker version.
- `wrangler delete`
  - remove a worker script.
- `wrangler versions` / `wrangler versions upload`
  - inspect versions and upload assets to a versioned deploy flow.

### Observability and runtime ops

- `wrangler tail`
  - stream real-time request logs.
  - supports filtering fields and output formats.

### Configuration and secrets

- `wrangler config`
  - inspect/write local/global CLI config.
- `wrangler secret`
  - manage worker secrets (create/list/delete).
- `wrangler secret bulk`
  - upload multiple secrets in one operation.

### State, storage, and platform services

- `wrangler kv`
  - namespaces and key/value operations.
- `wrangler r2`
  - object storage operations.
- `wrangler d1`
  - managed SQLite DB create/list/bulk SQL workflows.
- `wrangler queues`
  - create and inspect queues.
- `wrangler hyperdrive`
  - manage Hyperdrive connections.
- `wrangler vectorize`
  - vector index workflows.
- `wrangler workflows`
  - manage Worker Workflows.

### Pages + assets

- `wrangler pages`
  - manage Cloudflare Pages projects and deployments.
- `wrangler pages functions`
  - manage Pages Functions.

### Useful utilities

- `wrangler types`
  - generate types from bindings.
- `wrangler completion`
  - shell completion generation.

## CI/CD usage

Avoid interactive login in CI.

1. Use API token authentication and set account context.
2. Export:

```bash
export CLOUDFLARE_API_TOKEN=...
export CLOUDFLARE_ACCOUNT_ID=...
```

3. Deploy from CI:

```bash
npx wrangler deploy --env production
```

For strict non-interactive workflows, combine with `--config` and `--keep-vars` options according to project setup.

## Common gotchas

- If multiple Wrangler versions are installed, prefer `npx wrangler` or `corepack npm` for consistency.
- Some commands move from `publish` to `deploy` across major versions; prefer checking `wrangler --help` for your installed version.
- Use `--env` and `wrangler.toml` `[env]` sections consistently to avoid deploying to the wrong environment.

## References

- https://developers.cloudflare.com/workers/wrangler/
- https://developers.cloudflare.com/workers/wrangler/commands/
- https://developers.cloudflare.com/workers/wrangler/install-and-update/
- https://developers.cloudflare.com/workers/wrangler/ci-cd/
- https://developers.cloudflare.com/workers/wrangler/configuration/
- https://developers.cloudflare.com/workers/wrangler/configuration/toml-reference/
- https://developers.cloudflare.com/workers/wrangler/commands/deploy/
- https://developers.cloudflare.com/workers/wrangler/commands/tail/
- https://developers.cloudflare.com/workers/wrangler/commands/kv/
- https://developers.cloudflare.com/workers/wrangler/commands/r2/
- https://developers.cloudflare.com/workers/wrangler/commands/login/
- https://developers.cloudflare.com/workers/wrangler/commands/secret/
- https://developers.cloudflare.com/workers/wrangler/commands/workflows/
- https://developers.cloudflare.com/workers/wrangler/commands/pages/
