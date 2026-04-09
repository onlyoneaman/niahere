---
name: code-review
description: "Review pull requests, code diffs, and changes for correctness, design, security, performance, and style. Use when asked to 'review this PR,' 'review my changes,' 'check this diff,' or before merging code. Also use for pre-landing safety checks before shipping. Language-aware — adapts to the project's stack, idioms, and conventions."
metadata:
  version: 2.0.0
---

# Code Review

This skill has two modes. Read the appropriate file based on the task:

## Mode Selection

| Task | File |
|------|------|
| General PR/diff review (correctness, design, style, tests) | [pr-review.md](pr-review.md) |
| Pre-merge safety check (data safety, race conditions, trust boundaries) | [pre-landing.md](pre-landing.md) |
| About to ship/merge and want a final check | [pre-landing.md](pre-landing.md) |

## When to Use Which

- **pr-review**: Full review across 7 dimensions (intent, correctness, idioms, security, performance, testing, naming). Use for regular code review.
- **pre-landing**: Focused safety review for structural issues tests don't catch. Use right before merging. Terse output, critical/informational classification.

Both modes read project docs (CLAUDE.md, README, linter configs) before reviewing.
