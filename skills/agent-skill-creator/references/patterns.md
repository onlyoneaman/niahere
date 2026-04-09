# Skill Architecture Patterns

Concrete patterns for structuring skills. Examples use generic domains — adapt to your context.

---

## Progressive Disclosure

Skills load in three tiers:

| Tier | What | When | Cost |
|---|---|---|---|
| L1: Metadata | name + description | Session start | ~50-100 tokens/skill |
| L2: Body | SKILL.md content | When triggered | ~500-2000 tokens |
| L3: Resources | references/, scripts/, sub-files | On demand | Variable |

Design accordingly: routing decisions in L2, detailed knowledge in L3. The description (L1) is always loaded — it's the only thing that determines whether L2 ever loads.

---

## Pattern 1: Standalone

Single-purpose skill, one file.

```
deploy-checker/
├── SKILL.md          # Full workflow (~150 lines)
└── references/
    └── provider-configs.md
```

**Use when:** One workflow, under ~300 lines. Examples: CLI references, simple tools, single-process skills.

---

## Pattern 2: Router

Multiple related modes behind one entry point.

```
code-review/
├── SKILL.md              # Router (~25 lines)
├── pr-review.md          # Full PR review workflow
├── pre-landing.md        # Pre-merge safety checks
```

**Router body is just a routing table:**
```markdown
| Task | File |
|------|------|
| General PR review | [pr-review.md](pr-review.md) |
| Pre-merge safety check | [pre-landing.md](pre-landing.md) |
```

**Use when:**
- Domain has 2+ related workflows
- Combined content would exceed ~300 lines
- User may not know which mode they need

**How it helps:** Collapses N L1 entries into 1. Routing moves from L1 (scan all descriptions) to L2 (read one body). Only the relevant mode's content loads.

---

## Pattern 3: Shared References

Knowledge file used by multiple skills.

```
skill-a/
└── references/
    └── shared-principles.md    ← lives here

skill-b/SKILL.md references:
  ../skill-a/references/shared-principles.md

skill-c/SKILL.md references:
  ../skill-a/references/shared-principles.md
```

**Use when:** Multiple skills need the same domain knowledge. Put it in one place, link from others. Avoids duplication and drift.

---

## Pattern 4: Shared Data Layer

One skill creates context that many others consume.

```
context-builder/
└── SKILL.md    # Creates .agents/project-context.md

# Many other skills check for this file:
## Before Starting
If `.agents/project-context.md` exists, read it first.
```

**Use when:** Foundational context that prevents multiple skills from asking the same setup questions. Product info, org context, project state.

---

## Pattern 5: Knowledge Demotion

Convert a knowledge catalog (no workflow) into a reference file.

**Before** — standalone skill nobody directly invokes:
```
cognitive-biases/
└── SKILL.md          # 450 lines of reference material, no workflow
```

**After** — reference file linked from process skills:
```
persuasion-skill/references/cognitive-biases.md
```

**Rule:** If a skill has no imperative steps — no "Step 1, Step 2" — it's knowledge, not a skill. Make it a reference.

---

## Merge Heuristic

**Keep standalone if ANY is true:**
- Unique trigger phrase ("deploy to production" ≠ "review this PR")
- Specific tool/runtime dependency
- Distinct deliverable type
- Foundational pre-step for other skills

**Merge into router if ALL are true:**
- Same domain (user thinks of them as one thing)
- Same input shape (same context needed)
- User often unsure which sub-skill they need
- Each sub-skill under ~400 lines

---

## Description Examples

Diverse examples across domains:

**CLI tool:**
```yaml
description: "Terraform CLI reference and common workflows for plan, apply, state management, workspaces, and module development. Use when the user asks about terraform commands, infrastructure as code, or IaC workflows."
```

**Engineering process:**
```yaml
description: "Review pull requests and code diffs for correctness, design, security, performance, and style. Use when asked to 'review this PR,' 'review my changes,' 'check this diff,' or before merging code."
```

**Creative/marketing:**
```yaml
description: "Write marketing copy for landing pages, homepages, feature pages, and product pages. Use when the user says 'write copy,' 'headline help,' 'CTA copy,' or 'make this more compelling.' For email copy, see the email skill."
```

**Router:**
```yaml
description: "Unified plan review with CEO, engineering, and minimalist lenses. Use when reviewing a plan, strategy, or decision. Triggers: 'review my plan,' 'gut-check this,' 'is this too complex,' 'engineering review.'"
```

**Data/context:**
```yaml
description: "Create or update the product marketing context document that other skills use. Use when starting a new project, setting up positioning, defining ICP, or when other skills keep asking the same context questions."
```

---

## Anti-Patterns

| Problem | Why it fails | Fix |
|---|---|---|
| Vague description | Low activation rate | Add "Use when..." with 5+ trigger phrases |
| 500+ line monolith | Context bloat | Split into router + sub-files |
| Knowledge as standalone skill | Nobody invokes a reference catalog | Demote to reference file |
| Nested references (A → B → C) | Agent may partially read nested files | One level deep only |
| Duplicate content across SKILL.md and references | Token waste, drift risk | Process in SKILL.md, knowledge in references |
| First-person description | Breaks discovery (injected into system prompt) | Always third person |
| No negative boundaries | Triggers for wrong tasks | Add "For X, see Y instead" |
| Domain-specific examples in a generic skill | Confuses users from other domains | Use diverse examples |
