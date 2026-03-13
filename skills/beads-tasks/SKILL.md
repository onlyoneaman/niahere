---
name: beads-tasks
description: >
  Persistent task management via Beads CLI (bd). Use when user mentions tasks, todos, issues, or tracking work.
  Check `which bd` first — if missing, offer: `npm install -g @beads/bd`.
  Prefer setting `BEATS_DIR` (for example `~/.niahere/beads`) and run commands from there:
  `cd "$BEATS_DIR" && bd <command>`. Always label: `--label project:<project-name>`.
  Run `cd "$BEATS_DIR" && bd help-all` for available commands. Not for ephemeral in-conversation tracking.
---

## Overview

Global task manager powered by [Beads](https://github.com/steveyegge/beads). Stores all tasks in
`~/.niahere/beads/` as a single cross-project DB. Projects are organized via `project:<name>` labels.

## Quick Start

1. Check `which bd` — install if missing.
2. Ensure `~/.niahere/beads/.beads` exists — `bd init` if not.
3. Set `BEATS_DIR` to your Beads workspace (for example `~/.niahere/beads`).
4. All commands: `cd "$BEATS_DIR" && bd <command>`.
5. Always label with `--label project:<project-name>`.

## Decision Points

- User says "add a task" / "remind me to" / "track this" → `bd create`
- User says "what's on my plate" / "show tasks" → `bd list`
- User asks about a specific task → `bd show <id>`
- User says "done with X" / "finished" → `bd close <id>`
- User wants to see cross-project work → `bd list` (no project filter)
- User wants project-specific view → `bd list --label project:<name>`
- bd not installed → offer install, don't silently fail
- Ephemeral/conversation-only tracking → use conversation context, not beads

## Conventions

- Titles: descriptive, actionable (e.g. "Fix auth token refresh in niahere")
- Labels: `project:<name>`, `bug`, `feature`, `chore`, `urgent`
- Priority: default P2 unless user specifies urgency
- Status flow: `open` → `in_progress` → `closed`

## Validation

- `cd "$BEATS_DIR" && bd list` returns results after creating a task
- Labels appear correctly in list output
- Dependencies show in `bd dep tree`
