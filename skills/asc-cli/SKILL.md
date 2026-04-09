---
name: asc-cli
description: Use this skill for App Store Connect CLI (`asc`) usage, including install/auth setup, command families, CI/CD integration, and troubleshooting for releases, builds, TestFlight, metadata, signing, finance, and analytics workflows.
---

# App Store Connect CLI (`asc`)

Use this skill when the user asks about `asc` CLI command usage, automation patterns, CI/CD, or which `asc` command to run for a release workflow.

## Quick setup

1. Install `asc`:

```bash
# Recommended
brew install asc

# macOS/Linux fallback
curl -fsSL https://asccli.sh/install | bash
```

2. Verify installation:

```bash
asc --help
asc --version
```

3. Authenticate:

```bash
asc auth login \
  --name "MyApp" \
  --key-id "ABC123" \
  --issuer-id "DEF456" \
  --private-key /path/to/AuthKey.p8
```

For Apple API credentials, generate key details at:
https://appstoreconnect.apple.com/access/integrations/api

## Core command families

Use `asc <command> --help` for current flags and nested subcommands.

- `auth` — authentication and profile management.
- `doctor` — diagnose config/auth issues.
- `install-skills` — install asc skill pack for prebuilt workflows.
- `init` — initialize asc helper docs in repo.
- `docs` — open embedded documentation helpers.
- `analytics` — report and sales analytics.
- `insights` — weekly/daily insights.
- `finance` — financial and payout reports.
- `performance` — performance diagnostics.
- `feedback`, `crashes` — TestFlight feedback/crash discovery.
- `apps`, `app-info`, `versions`, `localizations` — app metadata lifecycle.
- `app-setup`, `app-tags`, `app-clips`, `android-ios-mapping` — setup and platform mappings.
- `screenshots`, `video-previews`, `background-assets`, `product-pages` — visual metadata assets.
- `builds`, `build-bundles`, `pre-release-versions` — binary build operations.
- `testflight`, `beta-app-localizations`, `beta-build-localizations`, `sandbox` — TestFlight workflows.
- `submit`, `validate`, `publish` — review/release workflows.
- `review`, `reviews` — review artifacts and customer reviews.
- `iap`, `subscriptions`, `offer-codes`, `app-events` — monetization workflows.
- `signing`, `certificates`, `profiles`, `bundle-ids`, `merchant-ids`, `pass-type-ids` — signing and identifiers.
- `notarization` — macOS notarization flow.
- `users`, `devices`, `account`, `actors` — team and access management.
- `xcode-cloud` — trigger and monitor Xcode Cloud runs.
- `webhooks`, `notify` — events and integrations.
- `workflow`, `status`, `metadata`, `diff`, `release-notes` — automation and planning utilities.

## Common practical commands

- List apps:

```bash
asc apps list --output table
```

- Upload a build:

```bash
asc builds upload --app "123456789" --file "/path/to/MyApp.ipa"
```

- Validate and submit:

```bash
asc validate --app "123456789" --version "1.2.3"
asc submit --app "123456789" --version "1.2.3"
```

- Pull TestFlight feedback and crashes:

```bash
asc feedback --app "123456789" --paginate
asc crashes --app "123456789" --sort -createdDate --limit 25
```

- Run a defined workflow:

```bash
asc workflow run --file .asc/workflow.json --workflow release
```

## Scripting and CI practices

- Use deterministic output:
  - `--output json` (default, machine-friendly, minified)
  - `--output table|markdown` for humans
  - `--paginate` to fetch all pages
- CI reporting:
  - `--report` (example `junit`)
  - `--report-file` to save artifacts.
- Multi-profile CI:
  - `asc --profile production ...`
  - Use explicit `--app`, `--limit`, `--paginate` for stable scripting.
- Auth in non-interactive CI:
  - Prefer `asc auth login --name ...` with secure secret handling and reuse stored profile.

## Troubleshooting and useful patterns

- "No guessing of flags": check help first (`asc <command> --help`).
- "No prompt surprises": for destructive writes, prefer `--confirm`.
- Error-heavy operations in scripts: pin exact versions and verify return codes.
- Apple quirks and API notes: https://github.com/rudrankriyam/App-Store-Connect-CLI/blob/main/docs/API_NOTES.md

## Non-official caveat

This project is unofficial and not affiliated with Apple. Confirm risk acceptance before replacing official tooling.

## Official references

- https://github.com/rudrankriyam/App-Store-Connect-CLI
- https://github.com/rudrankriyam/App-Store-Connect-CLI/blob/main/README.md
- https://github.com/rudrankriyam/App-Store-Connect-CLI/blob/main/docs/COMMANDS.md
- https://github.com/rudrankriyam/App-Store-Connect-CLI/blob/main/docs/CI_CD.md
- https://github.com/rudrankriyam/App-Store-Connect-CLI/blob/main/docs/API_NOTES.md
- https://github.com/rudrankriyam/App-Store-Connect-CLI/blob/main/AGENTS.md
- https://github.com/rudrankriyam/App-Store-Connect-CLI/releases
- https://asccli.sh/
- https://github.com/rudrankriyam/app-store-connect-cli-skills
