---
name: beads-tasks
description: >
  Persistent task management via Beads CLI (bd). Use when user mentions tasks, todos, issues, or tracking work.
  Check `which bd` first — if missing, offer: `npm install -g @beads/bd`.
  All commands: run from `$BEATS_DIR` (for example `~/.niahere/beads`) and use `bd <command>`. Always label: `--label project:<project-name>`.
  Run `bd help-all` for available commands. Not for ephemeral in-conversation tracking.
---

## Overview

Global task manager powered by [Beads](https://github.com/steveyegge/beads). Stores all tasks in
`~/.niahere/beads/` as a single cross-project DB. Projects are organized via `project:<name>` labels.

## Quick Start

1. Check `which bd` — install if missing.
2. Ensure `~/.niahere/beads/.beads` exists — `bd init` if not.
3. Set `BEATS_DIR` to your Beads workspace (for example `~/.niahere/beads`).
4. All commands: `cd "$BEATS_DIR" && bd <command>`.
5. Always label with `--label project:<name>`.
6. Run `cd "$BEATS_DIR" && bd help-all` for available commands.

## Core Commands

### Creating tasks

```bash
# Basic
bd create --title "Fix auth token refresh" --priority P2 --type bug

# With parent (subtask)
bd create --title "Extract shared logic" --priority P2 --type task --parent <parent-id>

# With description — ALWAYS add context: what's broken, links, references
bd create --title "Chat fails on long docs" --type bug --description "Fails on docs >500 pages. Ref: https://..."

# Epic (container for related tasks)
bd create --title "API performance improvements" --type epic --priority P2
```

### Updating tasks

`bd update` is the workhorse — use it for reparenting, reprioritizing, retyping, renaming:

```bash
bd update <id> --parent <new-parent-id>    # Reparent / move under epic
bd update <id> --parent ""                 # Remove parent (make top-level)
bd update <id> --priority P1               # Change priority
bd update <id> --type bug                  # Change type
bd update <id> --title "Better title"      # Rename
bd update <id> --status in_progress        # Start work
bd update <id> --description "..."         # Add/replace description
bd update <id> --add-label personal        # Add label
bd update <id> --set-labels bug,urgent     # Replace all labels
```

Chain multiple updates: `bd update <id> --priority P1 --type bug --parent <parent-id>`

### Viewing tasks

```bash
bd list                          # Open tasks (tree view)
bd list --all                    # Include closed/deferred tasks
bd list --label project:<name>   # Filter by project
bd show <id>                     # Full details of a task
bd children <id>                 # List children of a parent
```

### Closing tasks

```bash
bd close <id>                    # Close a task
bd reopen <id>                   # Reopen if closed prematurely
```

**Warning:** Closing a parent does NOT close or reparent its children. If a parent epic is done but children remain open, reparent them first or they become orphaned top-level items.

## Decision Points

- User says "add a task" / "remind me to" / "track this" → `bd create`
- User says "what's on my plate" / "show tasks" → `bd list`
- User asks about a specific task → `bd show <id>`
- User says "done with X" / "finished" → `bd close <id>`
- User wants to see cross-project work → `bd list` (no project filter)
- User wants project-specific view → `bd list --label project:<name>`
- bd not installed → offer install, don't silently fail
- Ephemeral/conversation-only tracking → use conversation context, not beads
- `bd set-state ... state=...` is for operational metadata only; it does not change the task status shown in list.

## Hierarchy & Organization

### When to use parent-child vs labels

- **Parent-child** (`--parent`): for structural grouping — epics containing subtasks, features broken into steps.
- **Labels** (`--add-label`): for cross-cutting tags — `personal`, `urgent`, `project:<name>`. A task can have multiple labels but only one parent.

### Epic patterns

- Use `--type epic` for containers that group related work.
- Epics can nest: epic > sub-epic > tasks.
- Keep epic titles broad ("API improvements"), subtask titles specific ("Reduce /search latency from 2s to 200ms").

### Cleanup & auditing

Periodically review with `bd list` and look for:
- **Orphaned tasks** — top-level items that should be under an epic.
- **Similar ungrouped tasks** — multiple tasks on the same topic that should share a parent.
- **Misplaced tasks** — bugs under improvement epics or vice versa.
- **Stale tasks** — open tasks that are actually done or no longer relevant.

When reorganizing, reparent with `bd update <id> --parent <new-parent>` — don't delete and recreate.

## Conventions

- **Titles:** descriptive, actionable (e.g. "Fix auth token refresh in niahere")
- **Descriptions:** always include context — what's broken, why it matters, links to references (Canny, threads, logs). Future you needs enough to start working without asking questions.
- **Types:** `epic`, `bug`, `feature`, `task`, `chore`, `decision`
- **Priority:** P0 (critical) → P4 (nice-to-have). Default P2 unless user specifies.
- **Labels:** `project:<name>`, `personal`, `bug`, `feature`, `chore`, `urgent`
- **Status flow:** `open` → `in_progress` → `closed`

## Validation

- `bd list` returns results after creating a task
- Labels appear correctly in list output
- Parent-child relationships show as indented tree in `bd list`
- Dependencies show in `bd dep tree`
