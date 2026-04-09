# Code Review — PR Review

Structured code review for pull requests and diffs. Adapts to the project's language, framework, and conventions by reading project documentation before reviewing code.

## Step 1: Gather Project Context

Before looking at any code, read these files if they exist:

- `CLAUDE.md` / `AGENTS.md` / `GEMINI.md` — project rules, code style, conventions
- `README.md` — project purpose, architecture overview
- `.editorconfig`, linter configs (`.eslintrc`, `pyproject.toml`, `rustfmt.toml`, etc.)
- `CONTRIBUTING.md` — contribution guidelines

From these, extract:
- **Language & framework** (TypeScript/Bun, Python/Django, Rust, Go, etc.)
- **Code style rules** (naming, imports, formatting)
- **Testing expectations** (unit, integration, what framework)
- **Architecture patterns** (module layout, type organization)
- **Any explicit review criteria** the project defines

## Step 2: Get the Diff

```bash
# For uncommitted changes
git diff

# For staged changes
git diff --cached

# For a branch vs main
git diff main...HEAD

# For a specific PR (GitHub)
gh pr diff <number>
```

Read all changed files in full (not just the diff) when context is needed to understand the change.

## Step 3: Review Passes

Run these passes in order. Each pass focuses on one concern — don't mix them.

### Pass 1: Intent & Design

- Does the change do what it claims? (PR title/description vs actual diff)
- Is the approach right? Could this be simpler?
- Is this the right place for this code? (module boundaries, separation of concerns)
- Over-engineering check: is code more generic than needed? Solving future problems?
- Are there unnecessary changes? (unrelated refactors, formatting-only changes mixed in)

### Pass 2: Correctness & Logic

- Off-by-one errors, boundary conditions, null/undefined handling
- Race conditions in async/concurrent code
- State mutations — are they safe? Expected?
- Error paths — what happens when things fail?
- Data flow — does data transform correctly through the pipeline?
- Are edge cases handled? (empty inputs, large inputs, unicode, timezone, etc.)

### Pass 3: Language Idioms & Best Practices

Adapt to the project's language. Apply that language's conventions:

**TypeScript/JavaScript:**
- Proper typing (no unnecessary `any`, correct generics, discriminated unions)
- Async/await over raw promises, proper error propagation
- Immutability preferences, const over let
- Node.js/Bun API usage (streams, buffers, path handling)

**Python:**
- PEP 8, Pythonic idioms (comprehensions, context managers, generators)
- Type hints where the project uses them
- Proper exception hierarchy, avoid bare `except:`
- f-strings over `.format()` or `%`

**Go:**
- Error handling patterns (check errors, don't ignore)
- Naming conventions (exported vs unexported, receiver names)
- Goroutine safety, channel usage, context propagation
- Avoid unnecessary interfaces

**Rust:**
- Ownership and borrowing correctness
- Error handling (`Result`/`Option`, avoid `.unwrap()` in library code)
- Clippy-clean idioms, iterator chains over manual loops
- Lifetime annotations only when needed

**Other languages:** Apply equivalent idiomatic standards. When unsure, check what the existing codebase does.

### Pass 4: Security

- Input validation at system boundaries (user input, API payloads, file uploads)
- SQL injection, XSS, command injection, path traversal
- Auth/authz checks — are they in the right place? Can they be bypassed?
- Secrets — no hardcoded keys, tokens, passwords
- Dependency changes — are new deps trusted? Pinned versions?
- OWASP Top 10 for web-facing code

### Pass 5: Performance

- N+1 queries, missing indexes, unbounded queries
- Unnecessary allocations in hot paths
- Missing pagination for list endpoints
- Large payloads loaded into memory
- Blocking operations in async contexts
- Caching opportunities (or cache invalidation bugs)

### Pass 6: Testing

- Are new code paths tested?
- Do tests actually assert behavior (not just "doesn't crash")?
- Edge cases covered? Error paths?
- Test names describe the scenario, not the implementation
- No test pollution (shared mutable state between tests)
- Missing tests flagged as an issue, not ignored

### Pass 7: Documentation & Naming

- Are names self-documenting? (variables, functions, types)
- Complex logic has comments explaining *why*, not *what*
- Public APIs have documentation
- Misleading names or outdated comments
- Breaking changes documented

## Step 4: Output Format

Structure the review as:

```markdown
## PR Review: <title or summary>

### Summary
<1-2 sentences on what the PR does and overall assessment>

### Critical (must fix)
- **[file:line]** Description of the issue
  - Why it matters
  - Suggested fix

### Important (should fix)
- **[file:line]** Description

### Suggestions (nice to have)
- **[file:line]** Description

### Positive
- Call out good patterns, clean abstractions, solid test coverage
```

**Severity guide:**
- **Critical:** Bugs, security issues, data loss risks, broken functionality
- **Important:** Design issues, missing tests, performance problems, convention violations
- **Suggestions:** Style improvements, alternative approaches, minor cleanups
- **Positive:** Things done well — always include at least one

## Decision Points

- If the diff is > 500 lines: split review by file/module, note that the PR might benefit from being broken up
- If no project docs exist: infer conventions from the existing codebase (read 2-3 similar files)
- If the PR has no description: note it, then infer intent from the diff
- If you're unsure about a pattern: flag it as a question, not a demand

## Anti-patterns to Avoid in Reviews

- Don't bikeshed on style that a linter should catch
- Don't rewrite the PR in your head — review what's there
- Don't block on personal preference when the code is correct
- Don't ignore test quality — bad tests are worse than no tests
- Don't review with only the diff — read surrounding code for context

## References

- [Google Engineering Practices — What to Look For](https://google.github.io/eng-practices/review/reviewer/looking-for.html)
- [Google — The Standard of Code Review](https://google.github.io/eng-practices/review/reviewer/standard.html)
- [Augment — 40 Questions Before You Approve](https://www.augmentcode.com/guides/code-review-checklist-40-questions-before-you-approve)
