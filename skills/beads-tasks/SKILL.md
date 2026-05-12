---
name: beads-tasks
description: >
  Persistent task management via Beads CLI (bd). Use when user mentions tasks, todos, issues, or tracking work.
  Check `which bd` first — if missing, offer: `npm install -g @beads/bd`.
  All commands: run from `$BEATS_DIR` (for example `~/.niahere/beads`) and use `bd <command>`. Always label: `--label project:<project-name>`.
  Run `bd --help` or `bd help --all` for available commands. Not for ephemeral in-conversation tracking.
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
6. Run `cd "$BEATS_DIR" && bd --help` or `bd help --all` for available commands.

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
bd update <id> --claim                     # Atomically claim work
bd update <id> --set-metadata team=platform # Set task-scoped metadata
```

Chain multiple updates: `bd update <id> --priority P1 --type bug --parent <parent-id>`

### Viewing tasks

```bash
bd list                          # Open tasks (tree view)
bd list --all                    # Include closed/deferred tasks
bd list --label project:<name>   # Filter by project
bd ready                         # Ready work with blocker-aware semantics
bd ready --claim                 # Atomically claim the first matching ready issue
bd show <id>                     # Full details of a task
bd show <id> --long              # Full details, including extended metadata
bd show --current --long         # Current/last touched issue with metadata
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

## Agent Session Tracking

When a Beads task is worked in Claude Code, Codex, or another agent CLI, store the active session on the task as metadata. Do not invent session IDs yourself; let the tool create the session, then attach the discovered session ID to the bead.

Use one shared metadata schema for all tools:

```bash
session_tool=codex|claude
session_id=<tool-created-session-id>
session_cwd=<absolute repo/worktree path>
session_resume_cmd=<exact resume command>
session_attached_at=<ISO timestamp>
```

Attach a session after starting or identifying it:

```bash
cd "$BEATS_DIR"
bd update <id> --claim
bd update <id> \
  --set-metadata session_tool=codex \
  --set-metadata session_id="$sid" \
  --set-metadata session_cwd="$PWD" \
  --set-metadata session_resume_cmd="cd $PWD && codex resume $sid" \
  --set-metadata session_attached_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
bd note <id> "Attached codex session $sid"
```

For Claude, use the same keys and a Claude resume command:

```bash
bd update <id> \
  --set-metadata session_tool=claude \
  --set-metadata session_id="$sid" \
  --set-metadata session_cwd="$PWD" \
  --set-metadata session_resume_cmd="cd $PWD && claude --resume $sid" \
  --set-metadata session_attached_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
```

Find session-backed tasks:

```bash
bd list --has-metadata-key session_id --all --long
bd list --metadata-field session_tool=codex --all --long
bd list --metadata-field session_tool=claude --all --long
bd show <id> --long
bd show --current --long
```

Use task metadata as the source of truth. `bd kv` is global and not task-scoped, so do not use it for task sessions. `bd audit` is append-only history, not a jump table. Notes/comments are useful human breadcrumbs, but the resume command and session ID should live in metadata.

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
