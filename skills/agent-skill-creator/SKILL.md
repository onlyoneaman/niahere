---
name: agent-skill-creator
description: Create or improve reusable agent skills that are framework-agnostic and easy to maintain. Use when building a new skill or updating an existing one with clear triggers, workflows, reusable resources, and validation steps.
---

## Agent Skill Creator

Create skills that any AI assistant can follow, not just one vendor or runtime.

## Default Location

New skills go in `~/.niahere/skills/<skill-name>/SKILL.md`. This directory is auto-scanned.
When updating an existing skill, edit it in place wherever it lives.

## Goals

- Make the skill portable across tools and agent frameworks.
- Keep instructions concise, explicit, and testable.
- Prefer reusable artifacts (scripts, references, templates) over repeating long instructions.

## Workflow

### 1. Clarify scope with concrete examples

Collect 3-5 realistic user requests the skill should handle.

For each example, define:
- Input shape (files, links, text, constraints)
- Expected output
- Quality bar (correctness, formatting, speed, safety)

### 2. Define trigger metadata

Write metadata that helps an agent decide when to use this skill.

- `name`: short, hyphenated, action-oriented
- `description`: what it does + clear trigger contexts

Write descriptions with explicit cues such as:
- task types
- file types
- domains
- decision boundaries (when not to use)

### 3. Design the skill structure

Pick the simplest structure that fits:

- Workflow-based: ordered steps for sequential processes
- Task-based: independent operations/tooling
- Reference-based: policy/spec driven tasks
- Hybrid: small workflow + task sections

Keep core instructions in `SKILL.md`. Move large detail into references.

### 4. Add reusable resources only when they pay off

Use optional folders as needed:

- `scripts/`: deterministic repeatable operations
- `references/`: detailed docs, schemas, standards
- `assets/`: templates, boilerplate, media, examples

Rules:
- Do not create empty folders by default.
- Avoid duplicate content between `SKILL.md` and references.
- Prefer one good script over long repeated prose.

### 5. Write implementation instructions

In `SKILL.md`, use imperative instructions and concrete decision points.

Include:
- quick-start flow
- fallback path for common failures
- output formatting expectations
- minimal examples

Avoid:
- tool/vendor lock-in unless explicitly required
- long conceptual explanations without action
- hidden assumptions about environment

### 6. Validate before shipping

Run this checklist:

- Metadata is clear and triggerable.
- Instructions are executable end-to-end.
- Optional resources are referenced from `SKILL.md`.
- Examples are realistic and match expected outputs.
- No unnecessary files (README, changelog, process notes).
- No conflicting or duplicated guidance.

### 7. Iterate from real usage

After first use:
- note where the agent hesitated or failed
- tighten trigger text and decision points
- move repeated logic into scripts/templates
- keep the file lean as capability grows

## Portable Skill Template

Use this starter when creating a new skill:

```markdown
---
name: your-skill-name
description: What this skill does and exactly when to use it.
---

## Overview
One short paragraph on scope and outcome.

## Quick Start
1. First action.
2. Main execution path.
3. Output requirements.

## Decision Points
- If condition A: do X.
- If condition B: do Y.
- If blocked: fallback path.

## Resources
- `scripts/...` for deterministic tasks.
- `references/...` for detailed docs.
- `assets/...` for templates and boilerplate.

## Validation
- Command or checklist to verify output quality.
```

## Editing an Existing Skill

When updating a skill:
- preserve existing behavior unless intentionally changing it
- document new triggers in description
- remove stale instructions immediately
- keep backward-compatible structure when possible

## Output Standard

A finished skill should be:
- discoverable (clear trigger description)
- executable (step-by-step, no ambiguity)
- maintainable (small core, reusable resources)
- portable (minimal runtime-specific assumptions)
