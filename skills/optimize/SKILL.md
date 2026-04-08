---
name: optimize
description: |
  Schedule or run an iterative optimization pass on code, prompts, copy, or any scorable
  target. Use when user asks to "optimize this", "run experiments", "autoresearch this",
  "iterate on this overnight", "can this be better", or proactively suggest after completing
  work that could benefit from further iteration. Also use when a job wants to self-optimize
  something within its own run. Handles spec confirmation, scoring setup, job scheduling,
  and result delivery. For the loop discipline itself, references the optimization-loop skill.
metadata:
  version: 1.0.0
---

# Optimize

Schedule or run autonomous optimization passes. This skill handles the orchestration —
when to use it, how to confirm specs, how to schedule, how to deliver results.

For the loop discipline, scoring methods, and workspace layout, invoke the
`optimization-loop` skill.

## Two Entry Points

### 1. User explicitly asks

User says "autoresearch this", "optimize this overnight", "run experiments on this",
"can you iterate on this more", or similar.

**Don't suggest — confirm and schedule.** The user already wants this. Move to Step 1.

### 2. Proactive suggestion (after immediate work)

You just finished a task — rewrote copy, tuned a prompt, optimized a function. The result
is good, but more iterations could find something better.

Suggest briefly:

> "This is solid. Want me to schedule an overnight optimization pass? I'll run ~30
> experiments scoring each version against [brief criteria] and have the best version
> ready by morning."

**Rules for suggesting:**

- Only suggest when there's a clear, scorable metric
- Only suggest when the target is self-contained (one file, one prompt, one section)
- Don't suggest for trivial tasks or quick fixes
- Don't push if the user declines — move on immediately
- Don't suggest if the user said they need this done now and can't wait

## Step 1: Confirm the Setup

Before scheduling, confirm these with the user. Be concise — a quick summary, not an
interrogation.

**Target** — What are we optimizing?

- A file (code, config, prompt file)
- A section of content (landing page hero, email subject line)
- A prompt or template

**Scoring method** — How do we know if a version is better?

- Code: what benchmark or test command produces a number?
- Content: what criteria matter? (clarity, persuasiveness, brevity, conversion, etc.)
- Custom: does the user have a specific scoring script?

**Constraints** — What can't change?

- Hard constraints (must-haves, test requirements, word limits)
- Soft preferences (shorter is better, simpler is better)

**Secondary metrics** — What must NOT get worse?

- Code: performance can't drop, memory can't increase, tests must pass
- Content: readability, brand voice, required elements
- These are regression guards — violations veto an otherwise good candidate

**Iterations** — How many experiments? Default 30. User can adjust.

**When** — Now, or schedule for later? If later, what time?

Example confirmation:

> "Here's the plan:
>
> - **Target**: signup prompt at `src/prompts/signup.md`
> - **Scoring**: pairwise comparison on clarity, persuasiveness, and brevity
> - **Constraints**: must mention free trial, keep under 150 words
> - **Regression guards**: readability must stay above grade 8
> - **Iterations**: 30 experiments
> - **When**: tonight at midnight
>
> Sound right?"

Wait for confirmation before proceeding.

## Step 2: Set Up the Workspace

Create the optimization directory:

```
~/.niahere/optimizations/{slug}-{hex}/
```

Where `{slug}` is a short descriptive name and `{hex}` is 4 random hex chars.

Create the frozen files:

1. **contract.md** — objective, target, primary metric, secondary metrics, constraints,
   preferences, budget, stop rules (see optimization-loop skill for template)
2. **rubric.md** — detailed scoring criteria
   - For code: the benchmark command and how to extract the metric
   - For content: the pairwise comparison rubric with specific criteria and weights
3. **baseline.md** — copy the current version of the target (the starting point)
4. **current-best.md** — copy of baseline (will be updated during the run)
5. **state.md** — initialize with "Run starting. 0 experiments completed."
6. **accepted/** — create empty directory

## Step 3: Compose the Job Prompt

Build a self-contained job prompt that encodes everything the agent needs to run
the optimization loop autonomously. The prompt must include:

```
Job: optimization — {slug}

You are running an optimization loop. Follow the optimization-loop pattern strictly.

## Your workspace
{absolute path to the optimization directory}

## What to optimize
{description of the target — file path, what it does, context}

## Current version
{full content of the target}

## Contract
{contents of contract.md}

## Scoring rubric
{contents of rubric.md}

## Loop instructions

Read your workspace files (contract.md, rubric.md, baseline.md, current-best.md,
state.md, results.jsonl) to understand the current state.

For each iteration:
1. Read state.md for context on what's been tried
2. Form a hypothesis — what to change and why
3. Produce a candidate version
4. Gate check — verify all hard constraints from the contract
5. Score — compare candidate vs current-best using the rubric (pairwise, randomized order)
6. If candidate is clearly better AND no secondary metric regressions:
   - Update current-best.md
   - Save candidate to accepted/{NNN}.md
   - Log {"status": "keep", ...} to results.jsonl
7. If not clearly better:
   - Discard candidate
   - Log {"status": "discard", ...} to results.jsonl
8. Update state.md with what you tried and learned

Stop when:
- Completed {N} iterations, OR
- {stop_count} consecutive discards (plateau), OR
- Target score reached (if specified in contract)

When finished, update state.md with a final summary and send a message to the user:
"[optimization] Done. Ran N experiments on {target}. X accepted, Y discarded.
{One-line summary}. Results: {workspace path}"

IMPORTANT:
- Do NOT modify contract.md or rubric.md
- Do NOT auto-apply results to the original file
- Do NOT stop to ask the user questions — run autonomously until done
```

## Step 4: Schedule the Job

Use the `add_job` MCP tool (preferred) or `nia job add` CLI:

- **name**: `optimize-{slug}` (e.g., `optimize-signup-prompt`)
- **schedule**: ISO timestamp for the agreed time, or now
- **schedule_type**: `once`
- **prompt**: the composed job prompt from Step 3
- **always**: `true` (overnight runs need to ignore active hours)
- **stateless**: `yes` (the optimization uses its own workspace, not the job's state.md)

Confirm to the user:

> "Scheduled. The optimization run starts at {time} and will run ~{N} experiments.
> I'll message you when it's done with the results."

## Step 5: After Completion

When the user asks about results, or when reviewing the notification:

1. Read `~/.niahere/optimizations/{slug}-{hex}/state.md` for the summary
2. Read `results.jsonl` for the experiment log
3. Show `current-best.md` vs `baseline.md` — the diff is the value
4. Show the accepted progression if the user wants to see the journey
5. Ask if the user wants to apply the result to the original target

## Running Now vs Later

**"Run it now":** Schedule with the current timestamp. The user stays in the conversation
and can check results when the job finishes. Good for shorter runs (10-15 iterations).

**"Schedule for later":** Schedule for a specific time (midnight, after hours). The user
goes about their day. The notification arrives when done. Good for longer runs (30+ iterations).

**"Run it inline":** If the user wants to optimize something RIGHT NOW in this conversation
(not as a job), you can run the optimization-loop pattern directly without scheduling a job.
Use this for quick 5-10 iteration runs where the user is watching.

## When a Job Self-Optimizes

A running job (e.g., news-curator, prompt-generator) can use this pattern to improve
its own approach. The flow:

1. Job creates an optimization subdirectory in its workspace or in `~/.niahere/optimizations/`
2. Runs the loop inline (not as a sub-job — within its own execution)
3. Saves the best version in the workspace
4. Does NOT auto-apply changes to its own prompt or config
5. Sends a message: "I found a better approach for [X]. Review at [path]."
6. The user decides whether to apply it (e.g., via `nia job update`)

## What NOT to Optimize

- Things without a clear metric (vague "make it better")
- Targets that require human judgment with no proxy (art, brand voice decisions)
- Multi-file changes with complex interdependencies
- Anything where the scoring takes longer than the modification (defeats the loop)
- Security-sensitive code where autonomous changes are risky

If the target doesn't fit, say so. Not everything benefits from iterative optimization.
Sometimes the first good version is the right answer.
