---
name: taskmaster
description: |
  Completion guard that prevents premature task abandonment. Use when wrapping up
  any non-trivial task, before claiming work is "done", or when you catch yourself
  writing a summary instead of finishing the work. Also use when the user says
  "don't stop early", "finish everything", "make sure it's actually done", or
  "verify completion". Adapted from github.com/blader/taskmaster.
---

# Taskmaster

Completion guard. Progress is not completion. Before you stop, prove the work is done.

## When to Invoke

- Before claiming any non-trivial task is complete
- When you're about to write a summary of what you did
- When you notice yourself using phrases like "significant progress", "mostly done", or "remaining work would require..."
- When the user explicitly asks you to finish everything

## The Completion Checklist

Run every item. Do not skip any. Do not summarize — execute.

### 1. Goal Confrontation (Do This First)

Answer these three questions explicitly in your response:

a. **What is the user's stated goal or success criterion?** Write it out verbatim.
b. **Is it achieved RIGHT NOW?** Answer "yes" or "no". Not "partially", not "mostly", not "significant progress was made". Yes or no.
c. **If no:** you are NOT DONE. Go do more work.

The ONLY exception is if the user explicitly told you to stop or deprioritized the goal. There is no other valid reason to stop.

### 2. Re-read the Original Request

Go back to the user's original message(s). List every discrete request or acceptance criterion. For each one, confirm it is **fully addressed** — not started, not in progress, FULLY done.

If the user changed their mind or withdrew a request, treat it as resolved.

### 3. Check the Task List

Review every task. Any task not marked completed? Do it now — unless the user said to skip it.

### 4. Check the Plan

Walk through each step of the plan, INCLUDING verification steps. Any step skipped or partially done? Finish it.

If the plan includes verification steps (builds, tests, lints, type-checks, smoke tests), you MUST actually run them and see them pass. Do not skip them or claim they pass without evidence.

### 5. Check for Errors

Did anything fail or remain unfinished? Fix it. This applies to ALL types of problems — logic errors, missing functionality, incomplete refactors, broken scripts, configuration issues, or anything else that prevents the work from being fully done.

### 6. Check for Loose Ends

- TODO comments you left behind?
- Placeholder code?
- Missing tests for new code?
- Untested changes?
- Follow-ups you noted but didn't act on?

If any exist, resolve them now.

### 7. Check for Blockers

If something is blocking you, do NOT give up. Try a different approach, read more code, search for examples, re-examine your assumptions.

"I didn't cause this bug" is not an excuse to stop — if it blocks your task, fix it. You own the outcome, not just your diff.

## Anti-Rationalization Guide

These are NOT valid reasons to stop:

| Rationalization | Reality |
|---|---|
| "Diminishing returns" | The goal isn't met. Keep working. |
| "Significant progress was made" | Progress is not completion. |
| "Would require broader architectural changes" | Then make them. |
| "No single dominant hotspot" | Keep looking. |
| "Tried N approaches" | Try N+1. |
| "I can't do X" | You haven't tried X yet. |
| "This is a pre-existing issue" | If it blocks your task, it's your issue. |
| "The remaining work is complex" | That's not a reason to stop. That's a description of your job. |

## Do Not Narrate — Execute

If any incomplete work remains, your ONLY job is to DO that work right now.

- Do NOT respond by explaining what the remaining tasks are
- Do NOT describe their complexity or list their dependencies
- Do NOT ask for permission to proceed
- Do NOT write summaries of what is left

Open files, write code, run commands, fix bugs. Act.

## User Instructions Override

The user's latest instructions always take priority. If the user said to stop, move on, or skip something — respect that. Do not force completion of work the user no longer wants.

## Attribution

Core ideas adapted from [Taskmaster](https://github.com/blader/taskmaster) by blader (MIT).
