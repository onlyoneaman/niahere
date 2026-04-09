---
name: agent-skill-creator
description: "Create or improve AI agent skills with proper progressive disclosure, description optimization, and router patterns. Use when building a new skill, updating an existing one, merging related skills into a router, auditing skill quality, or improving skill activation rates. Also use when the user mentions 'create a skill,' 'write a skill,' 'new skill,' 'skill template,' 'improve this skill,' 'skill isn't triggering,' 'merge these skills,' or 'skill architecture.'"
metadata:
  version: 2.1.0
---

# Skill Creator

## Before Starting

1. **New or improving?** — Creating from scratch vs updating existing
2. **Process or knowledge?** — Workflow steps → skill. Reference catalog → `references/` file, not a standalone skill.
3. **Standalone or merge?** — Check if related skills exist that should become one router.

## Step 1: Write the Description

The description determines activation. Most important thing you write.

**Rules:**
- Third person only
- WHAT it does + WHEN to use it + 5+ trigger phrases
- Negative boundaries (what it does NOT do)
- Max 1024 characters

```yaml
description: "[What — 1 sentence]. Use when [context]. Also use when the user mentions '[phrase1],' '[phrase2],' ... [For X, see other-skill.]"
```

## Step 2: Choose Structure

**Standalone** — single workflow, under ~300 lines total.
**Router** — multiple modes, combined >300 lines, user may not know which mode they need.

For detailed structure patterns with examples, see [references/patterns.md](references/patterns.md).

## Step 3: Write the Body

**Process in SKILL.md, knowledge in references.** Keep body under 500 lines.

For standalone skills — imperative steps with decision points:
```markdown
## Workflow
1. [Action]
2. [Decision — if X do A, if Y do B]
3. [Output]
```

For router skills — just a routing table:
```markdown
## Mode Selection
| Task | File |
|------|------|
| Task A | [mode-a.md](mode-a.md) |
| Task B | [mode-b.md](mode-b.md) |
```

References one level deep only. Every reference linked from SKILL.md with "when to read" context.

## Step 4: Cross-reference

- **Within skill** (router → sub-files): markdown file links — `[mode-a.md](mode-a.md)`
- **Between skills**: instructional prose — "Invoke the `other-skill` skill"
- **Shared knowledge**: relative path links — `[ref](../other-skill/references/ref.md)`

## Step 5: Validate

- [ ] Description: third person, "Use when...", 5+ triggers, negative boundaries, <1024 chars
- [ ] Body under 500 lines
- [ ] References linked with "when to read" context, one level deep
- [ ] Process and knowledge separated
- [ ] No stale cross-references
- [ ] If router: routing table clear, sub-files under ~400 lines each

## Step 6: Iterate

After use, observe: Did it trigger correctly? Did the agent load the right content? Tighten description triggers and routing based on what you see.

## Editing Existing Skills

- Preserve behavior unless intentionally changing
- Update description if scope changed
- If over 500 lines → convert to router
- If pure knowledge with no workflow → demote to reference file

## References

- [Architecture Patterns](references/patterns.md) — progressive disclosure tiers, standalone vs router vs shared reference patterns, merge heuristics, description examples across domains, anti-patterns. Read this when choosing structure or writing descriptions.
