---
name: plan-review
version: 2.0.0
description: |
  Unified plan review skill with three lenses. Use when reviewing a plan,
  strategy, or decision — whether from a CEO/founder strategic perspective,
  engineering rigor perspective, or minimalist entrepreneur perspective.
  Triggers: plan review, review my plan, challenge this plan, gut-check,
  simplify this, scope check, 10-star product, architecture review,
  test coverage review, edge cases, minimalist review, business decision review.
allowed-tools:
  - Read
  - Grep
  - Glob
  - Bash
  - AskUserQuestion
---

# Plan Review Router

This skill routes to one of three review modes based on what the user needs.

## Routing Table

| Mode | When to use | File |
|------|-------------|------|
| **CEO/Founder Strategic Review** | Rethink the problem, challenge premises, find the 10-star product, expand or reduce scope strategically. Three sub-modes: SCOPE EXPANSION, HOLD SCOPE, SCOPE REDUCTION. | [ceo.md](ceo.md) |
| **Engineering Rigor Review** | Lock in architecture, data flow, edge cases, test coverage, performance. Interactive walkthrough with opinionated recommendations. | [eng.md](eng.md) |
| **Minimalist Entrepreneur Review** | Gut-check a business decision through the minimalist entrepreneur lens. Simplify, validate, decide. | [minimalist.md](minimalist.md) |

## How to Route

1. If the user specifies a lens (e.g., "CEO review", "eng review", "minimalist review"), go directly to that file.
2. If the context makes it obvious (e.g., architecture/test questions -> eng, business strategy -> CEO, simplification -> minimalist), route accordingly.
3. If unsure which mode, ask the user what lens they want: **strategic vision**, **engineering rigor**, or **simplicity**.

## Quick Signals

- "dream big", "10-star", "ambitious", "cathedral", "scope expansion" -> [ceo.md](ceo.md)
- "architecture", "edge cases", "test coverage", "data flow", "performance" -> [eng.md](eng.md)
- "simplify", "gut-check", "should I even build this", "minimalist", "MVP" -> [minimalist.md](minimalist.md)
