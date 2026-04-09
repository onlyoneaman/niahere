# Code Review — Pre-Landing Review

Analyze the current branch's diff against main for structural issues that tests don't catch.

---

## Step 1: Check branch

1. Run `git branch --show-current` to get the current branch.
2. If on `main`, output: **"Nothing to review — you're on main or have no changes against main."** and stop.
3. Run `git fetch origin main --quiet && git diff origin/main --stat` to check if there's a diff. If no diff, output the same message and stop.

---

## Step 2: Get the diff

```bash
git fetch origin main --quiet
git diff origin/main
```

This includes both committed and uncommitted changes against the latest main.

---

## Step 3: Two-pass review

Apply the checklist below against the diff in two passes:

1. **Pass 1 (CRITICAL):** Data Safety, Trust Boundaries, Race Conditions
2. **Pass 2 (INFORMATIONAL):** Conditional Side Effects, Magic Numbers, Dead Code, LLM Prompt Issues, Test Gaps, Frontend Issues

Follow the output format specified below. Respect the suppressions — do NOT flag items in the "DO NOT flag" section.

---

## Step 4: Output findings

**Always output ALL findings** — both critical and informational.

- If CRITICAL issues found: output all findings, then for EACH critical issue use a separate AskUserQuestion with the problem, your recommended fix, and options (A: Fix it now, B: Acknowledge, C: False positive — skip).
- If only non-critical issues found: output findings. No further action needed.
- If no issues found: output `Pre-Landing Review: No issues found.`

---

## Review Checklist

### Pass 1 — CRITICAL

#### Data Safety
- String interpolation/concatenation in SQL or database queries (use parameterized queries)
- TOCTOU races: check-then-set patterns that should be atomic operations
- Bypassing validations on writes to fields that have or should have constraints
- N+1 queries: missing eager loading for associations used in loops/views

#### Race Conditions & Concurrency
- Read-check-write without uniqueness constraint or conflict handling
- Find-or-create patterns on columns without unique DB index — concurrent calls can create duplicates
- Status transitions that don't use atomic compare-and-swap — concurrent updates can skip or double-apply
- Rendering user-controlled data as trusted HTML (XSS)

#### Trust Boundaries
- LLM/AI-generated values (emails, URLs, names) written to DB or used in actions without format validation
- Structured tool output (arrays, objects) accepted without type/shape checks before database writes
- External API responses used without validation
- User input passed to system commands without sanitization

### Pass 2 — INFORMATIONAL

#### Conditional Side Effects
- Code paths that branch on a condition but forget to apply a side effect on one branch (creating inconsistent state)
- Log messages that claim an action happened but the action was conditionally skipped

#### Magic Numbers & String Coupling
- Bare numeric literals used in multiple files — should be named constants
- Error message strings used as query filters elsewhere

#### Dead Code & Consistency
- Variables assigned but never read
- Comments/docstrings that describe old behavior after the code changed
- Changelog/version inconsistencies

#### LLM Prompt Issues
- 0-indexed lists in prompts (LLMs reliably return 1-indexed)
- Prompt text listing available tools/capabilities that don't match what's actually wired up
- Token/word limits stated in multiple places that could drift

#### Test Gaps
- Negative-path tests that assert type/status but not side effects
- Assertions on string content without checking format
- Security enforcement features without integration tests verifying the enforcement path end-to-end
- Missing "should NOT call" assertions when a code path should explicitly skip an external service

#### Crypto & Entropy
- Truncation of data instead of hashing (less entropy, easier collisions)
- Non-cryptographic random for security-sensitive values
- Non-constant-time comparisons on secrets or tokens (timing attacks)

#### Time Window Safety
- Date-key lookups that assume "today" covers 24h
- Mismatched time windows between related features

#### Type Coercion at Boundaries
- Values crossing language/serialization boundaries where type could change (numeric vs string)
- Hash/digest inputs that don't normalize types before serialization

#### Frontend/View
- Inline styles in repeated components (re-parsed every render)
- O(n*m) lookups in views (linear search in a loop instead of hash lookup)
- Client-side filtering of large datasets that should be server-side

---

## Gate Classification

```
CRITICAL (blocks ship):          INFORMATIONAL (noted in PR):
|- Data Safety                   |- Conditional Side Effects
|- Race Conditions               |- Magic Numbers & String Coupling
|- Trust Boundaries              |- Dead Code & Consistency
                                 |- LLM Prompt Issues
                                 |- Test Gaps
                                 |- Crypto & Entropy
                                 |- Time Window Safety
                                 |- Type Coercion at Boundaries
                                 |- Frontend/View
```

---

## Output Format

```
Pre-Landing Review: N issues (X critical, Y informational)

**CRITICAL** (blocking):
- [file:line] Problem description
  Fix: suggested fix

**Issues** (non-blocking):
- [file:line] Problem description
  Fix: suggested fix
```

If no issues: `Pre-Landing Review: No issues found.`

Be terse. One line problem, one line fix. No preamble.

---

## Suppressions — DO NOT flag these

- "X is redundant with Y" when the redundancy is harmless and aids readability
- "Add a comment explaining why this threshold was chosen" — thresholds change, comments rot
- "This assertion could be tighter" when the assertion already covers the behavior
- Suggesting consistency-only changes
- "Regex doesn't handle edge case X" when the input is constrained and X never occurs in practice
- "Test exercises multiple guards simultaneously" — that's fine
- Eval threshold/config value changes that are tuned empirically
- Harmless no-ops
- ANYTHING already addressed in the diff you're reviewing — read the FULL diff before commenting

## Important Rules

- **Read the FULL diff before commenting.** Do not flag issues already addressed in the diff.
- **Read-only by default.** Only modify files if the user explicitly chooses "Fix it now" on a critical issue. Never commit, push, or create PRs.
- **Be terse.** One line problem, one line fix. No preamble.
- **Only flag real problems.** Skip anything that's fine.
