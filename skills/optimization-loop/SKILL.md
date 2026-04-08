---
name: optimization-loop
description: |
  The iterative optimization pattern (Karpathy Loop / autoresearch). Reference for running
  autonomous experiment loops on any target: modify → score → keep or revert → repeat.
  Use when running multiple iterations of improvement against a measurable metric — code
  benchmarks, prompt quality, copy effectiveness, config tuning, or any scorable target.
  Also known as "autoresearch." Use this skill to understand the pattern and discipline.
  For orchestration (scheduling, user confirmation, job setup), see the "optimize" skill.
metadata:
  version: 1.0.0
---

# Optimization Loop

The Karpathy Loop: autonomous iterative optimization through disciplined experimentation.
Modify a target, score the result, keep improvements, revert failures, repeat.

This skill defines the **pattern and discipline**. For when/how to schedule and orchestrate
optimization runs, see the `optimize` skill.

## The Pattern

```
freeze contract + rubric
save baseline (never touch again)
copy baseline → current-best

repeat:
  1. read state — what's been tried, what worked
  2. hypothesize — form a specific idea, informed by history
  3. modify — produce a candidate version
  4. gate check — hard constraints pass? if no → reject
  5. score — compare candidate vs current-best (pairwise)
  6. decide — clearly better? keep. otherwise revert.
  7. log — append to results.jsonl
  8. update state — what you tried, what happened, what next

until: budget exhausted, target reached, or plateau detected
notify user with summary
```

## Workspace Layout

Each optimization run gets a dedicated, self-contained directory:

```
~/.niahere/optimizations/{slug}-{hex}/
├── contract.md           # Frozen at start: objective, scope, constraints, metrics, budget
├── rubric.md             # Frozen at start: scoring criteria (never modify during run)
├── baseline.md           # Original version (never modify)
├── current-best.md       # Best version so far (update only on accept)
├── accepted/             # Every accepted candidate, numbered
│   ├── 001.md
│   ├── 002.md
│   └── ...
├── results.jsonl         # One JSON object per experiment (append-only)
└── state.md              # Your working notebook
```

**The slug** is human-readable (e.g., `signup-prompt`). The hex suffix (4 chars) prevents
collisions across multiple runs on the same target.

## The Contract (contract.md)

Freeze this at the start. Never modify during the run.

```markdown
# Optimization Contract

## Objective

[What we're optimizing and why — one sentence]

## Target

[File path or content being modified]
[Which sections/parts are in scope — be specific]

## Primary Metric

[The metric being optimized — what "better" means]

## Secondary Metrics (regression guards)

[Metrics that must NOT degrade. Each with a threshold.]

- [e.g., "Word count must stay under 200"]
- [e.g., "All existing tests must pass"]
- [e.g., "Readability score must stay above grade 8"]

## Hard Constraints

[Violations = automatic reject, no exceptions]

- [e.g., "Must mention the free trial"]
- [e.g., "Must pass lint and type check"]

## Soft Preferences

[Tiebreakers — not vetoes, but guide decisions]

- [e.g., "Prefer shorter over longer"]
- [e.g., "Prefer simple over clever"]

## Budget

- Max iterations: [N]
- Max wall-clock time: [hours]

## Stop Rules

- All iterations completed
- Target score reached: [if applicable]
- Plateau: [N] consecutive discards (default 5)
```

## Scoring

### For code targets

Run a benchmark or test command. Extract the metric. The command is fixed in the contract
and cannot be modified during the run.

```
1. Gate check: tests pass? lint clean? types check? → if any fail, reject immediately
2. Run benchmark command → extract primary metric
3. Check secondary metrics for regressions → if any violated, reject
4. Compare primary metric against current-best
5. Accept only if clearly improved (above noise floor)
```

### For content targets (prompts, copy, configs)

Use pairwise comparison. Never absolute 1-10 scoring.

```
1. Gate check: hard constraints met? (word count, required elements, etc.)
2. Present both versions side by side:
   - Randomly assign which is "Version A" and "Version B"
   - Do NOT label which is current-best vs candidate
3. Evaluate using the frozen rubric criteria
4. Pick the winner — candidate must be CLEARLY better, not just different
5. If it's a toss-up, reject (bias toward stability)
6. Check secondary metrics for regressions
```

**Anti-bias controls for LLM-as-judge:**

- Randomize A/B order every time (prevents position bias)
- Never reveal which version is "current" vs "candidate"
- If the margin is slim, run the comparison twice with swapped order
- The rubric is frozen in `rubric.md` — you cannot modify scoring criteria mid-run

## Exploration Strategy

Don't just make incremental tweaks. Use staged exploration:

**Early phase (first ~30% of iterations):** Go broad. Try fundamentally different approaches.
Different structures, different angles, different trade-offs. You're mapping the space.

**Exploit phase (middle ~50%):** You've found something that works. Refine around it.
Incremental improvements, wording tweaks, parameter tuning.

**Escape phase (if plateaued):** If you hit 5 consecutive discards, try ONE radical departure
from current-best — something completely different. If that fails too, stop. You've likely
found a local optimum.

## The Results Log (results.jsonl)

Append one JSON object per experiment. Never edit previous entries.

```json
{"n": 1, "status": "keep", "hypothesis": "shorter opening hook", "score_note": "candidate clearly more direct", "duration_s": 45, "timestamp": "2026-04-07T02:14:00Z"}
{"n": 2, "status": "discard", "hypothesis": "add social proof", "score_note": "toss-up, rejected for stability", "duration_s": 38, "timestamp": "2026-04-07T02:21:00Z"}
{"n": 3, "status": "crash", "hypothesis": "doubled context window", "error": "benchmark timed out", "duration_s": 300, "timestamp": "2026-04-07T02:28:00Z"}
```

Every entry must include:

- `n` — experiment number
- `status` — `keep`, `discard`, or `crash`
- `hypothesis` — what you tried and why (one line)
- `score_note` — why you kept or discarded (one line)
- `timestamp` — when the experiment completed

## Resumability

If the run crashes or is interrupted:

1. Read `current-best.md` — this is always the last accepted version
2. Read `results.jsonl` — count completed experiments, review what was tried
3. Read `state.md` — pick up your thinking from where you left off
4. Continue from the next experiment number
5. Do NOT re-run completed experiments

## Scoring Integrity

**The scorer and the optimizer must be separated in intent.** You are both proposer and judge,
so you must be disciplined:

- The rubric is frozen. Do not adjust criteria because a candidate "almost" passes.
- Do not add special cases to make a favorite candidate win.
- Do not lower the bar after repeated failures. If nothing passes, that's a valid outcome.
- If you notice you're gaming your own rubric, stop and note it in state.md.

## When Finished

1. Update `state.md` with a final summary:
   - Baseline description vs final best description
   - Total experiments: N run, X accepted, Y discarded, Z crashed
   - Key findings: what worked, what didn't, surprises
2. Send a message to the user (via `send_message`):
   ```
   [optimization] Done. Ran N experiments on [target].
   X accepted, Y discarded. [One-line summary of the best version vs baseline].
   Results: ~/.niahere/optimizations/{slug}-{hex}/
   ```
3. Do NOT auto-apply the result. The user reviews `current-best.md` and decides
   whether to use it.

## Principles

- **Propose, never apply.** The optimization produces a candidate. The user promotes it.
- **Simplicity criterion.** A marginal improvement that adds complexity isn't worth keeping.
  Removing something while maintaining quality is always a win.
- **Bias toward stability.** When in doubt, reject. Keeping a good version is better than
  accepting a sideways move.
- **One target, one metric, one run.** Don't try to optimize multiple things simultaneously.
  Run separate optimizations for separate targets.
