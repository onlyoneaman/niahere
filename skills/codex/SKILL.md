---
name: codex
description: Consult OpenAI Codex CLI for a second opinion on plans, tests, code review, and more. Use this skill automatically whenever a second perspective would strengthen your output — especially for architectural plans, code review, test strategy, and debugging.
argument-hint: "[task] [details...]"
allowed-tools: Bash(codex *), Bash(codex exec *)
---

## Runtime Scope

- Use this skill in Claude Code workflows.
- If the active assistant is Codex and this skill is referenced, do not invoke Codex CLI directly; use a subagent for the second-opinion task instead.

Consult the OpenAI Codex CLI as a second-opinion advisor. Use its output to compare, validate, or enrich your own analysis.

**User request:** $ARGUMENTS

## Instructions

### Step 1: Determine the consultation type

Based on the user's request, determine which mode applies:

- **plan** — Ask Codex to propose an implementation plan or architecture
- **review** — Ask Codex to review specific code for bugs, style, and improvements
- **test** — Ask Codex to suggest test cases or generate tests for specific code
- **explain** — Ask Codex to explain how specific code works
- **debug** — Ask Codex to analyze a bug or error and suggest fixes
- **general** — Any other consultation

### Step 2: Gather context

Before calling Codex, gather relevant context so you can craft a focused prompt:

- Read the files relevant to the user's request
- Check `git diff --stat` or `git log --oneline -10` if the request involves recent changes
- Understand what specific question or area the user wants Codex's perspective on

### Step 3: Call Codex

Run Codex via `codex exec` in non-interactive mode. Always pass `-C` with the project directory.

**For read-only consultation (review, explain, debug):**
```bash
codex exec -s read-only "YOUR_PROMPT" -C /path/to/project
```

**For code generation (test, plan with output):**
```bash
codex exec -s workspace-write "YOUR_PROMPT" -C /path/to/project
```

**For code review specifically:**
```bash
codex exec review -C /path/to/project
```

#### CLI Reference (codex-cli v0.114.0)

| Flag | Description |
|------|-------------|
| `-s read-only` | Read-only sandbox — can read files but not modify |
| `-s workspace-write` | Can write to workspace |
| `-C /path` | Set working directory |
| `-m MODEL` | Override model (e.g. `-m o3`) |
| `--json` | Output events as JSONL |
| `--ephemeral` | Don't persist session files |
| `-o FILE` | Write last message to file |
| `-c key=value` | Override config (e.g. `-c model="o3"`) |
| `--full-auto` | Convenience alias for sandboxed auto-execution |

**Do NOT use these (they don't exist):**
- `--quiet` — not a valid flag
- `--approval-mode` — not a valid flag
- Top-level `codex "prompt"` for non-interactive — use `codex exec` instead

#### Prompt crafting rules
- Include the specific file paths and relevant code context
- Be explicit about what you want: "Review this code for bugs", "Propose a plan to implement X", "Write unit tests for Y"
- Include constraints: "This project uses [framework/language]. Follow existing patterns."
- Keep it focused — one clear ask per invocation

If the output is too large or Codex needs to examine many files, break it into multiple focused calls.

If `codex` is not installed, tell the user:
> Codex CLI is not installed. Install it with: `npm install -g @openai/codex`
> Make sure your `OPENAI_API_KEY` environment variable is set.

Then stop.

### Step 4: Synthesize

Do NOT just dump Codex's raw output. Instead:

1. **Present Codex's perspective** — summarize its key points clearly
2. **Add your own analysis** — where do you agree or disagree? What did it miss? What did it catch that you wouldn't have?
3. **Highlight conflicts** — if Codex's suggestion contradicts the project's existing patterns or the user's preferences, flag it
4. **Give a recommendation** — a clear, unified recommendation combining the best of both perspectives

Format the output as:

---

## Codex Consultation

**Query:** (what was asked)

### Codex's Take
(summarized key points from Codex output)

### My Analysis
(where you agree, disagree, or would extend Codex's suggestions)

### Conflicts & Caveats
(any contradictions with existing codebase patterns, CLAUDE.md rules, or project conventions)

### Recommendation
(unified recommendation — the best path forward considering both perspectives)

---

### Step 5: Offer next steps

Ask the user if they want to:
- Act on the recommendation
- Ask Codex a follow-up question
- Get deeper analysis on a specific point

## Keeping This Skill Up To Date

This skill was last verified against **codex-cli v0.114.0**. If Codex CLI is updated and commands fail, run `codex exec --help` to check current flags and update this skill accordingly. Common things that change between versions:
- Flag names and aliases
- Sandbox mode values
- Subcommands (e.g. `exec review` was added later)
- Default model names
