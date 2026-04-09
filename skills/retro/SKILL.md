---
name: retro
description: |
  Engineering retrospective. Analyzes commit history, work patterns,
  and code quality metrics with persistent history and trend tracking.
  Team-aware: breaks down per-person contributions with praise and growth areas.
  Use when asked to "retro", "retrospective", "how did the week go", or "review my commits".
argument-hint: "[7d|24h|14d|30d|compare|compare 14d]"
allowed-tools:
  - Bash
  - Read
  - Write
  - Glob
  - AskUserQuestion
---

# /retro — Engineering Retrospective

Generates a comprehensive engineering retrospective analyzing commit history, work patterns, and code quality metrics. Team-aware: identifies the user running the command, then analyzes every contributor with per-person praise and growth opportunities.

## Arguments
- `/retro` — default: last 7 days
- `/retro 24h` — last 24 hours
- `/retro 14d` — last 14 days
- `/retro 30d` — last 30 days
- `/retro compare` — compare current window vs prior same-length window
- `/retro compare 14d` — compare with explicit window

## Instructions

Parse the argument to determine the time window. Default to 7 days if no argument given. Use `--since="N days ago"`, `--since="N hours ago"`, or `--since="N weeks ago"` (for `w` units) for git log queries.

**Argument validation:** If the argument doesn't match a number followed by `d`, `h`, or `w`, the word `compare`, or `compare` followed by a number and `d`/`h`/`w`, show usage and stop.

### Step 1: Gather Raw Data

First, fetch origin and identify the current user:
```bash
git fetch origin main --quiet
git config user.name
git config user.email
```

The name returned by `git config user.name` is **"you"** — the person reading this retro. All other authors are teammates.

Run ALL of these git commands in parallel (they are independent):

```bash
# 1. All commits in window with timestamps, subject, hash, AUTHOR, files changed
git log origin/main --since="<window>" --format="%H|%aN|%ae|%ai|%s" --shortstat

# 2. Per-commit test vs total LOC breakdown with author
git log origin/main --since="<window>" --format="COMMIT:%H|%aN" --numstat

# 3. Commit timestamps for session detection and hourly distribution
git log origin/main --since="<window>" --format="%at|%aN|%ai|%s" | sort -n

# 4. Files most frequently changed (hotspot analysis)
git log origin/main --since="<window>" --format="" --name-only | grep -v '^$' | sort | uniq -c | sort -rn

# 5. PR numbers from commit messages
git log origin/main --since="<window>" --format="%s" | grep -oE '#[0-9]+' | sed 's/^#//' | sort -n | uniq | sed 's/^/#/'

# 6. Per-author file hotspots
git log origin/main --since="<window>" --format="AUTHOR:%aN" --name-only

# 7. Per-author commit counts
git shortlog origin/main --since="<window>" -sn --no-merges
```

### Step 2: Compute Metrics

Calculate and present these metrics in a summary table:

| Metric | Value |
|--------|-------|
| Commits to main | N |
| Contributors | N |
| PRs merged | N |
| Total insertions | N |
| Total deletions | N |
| Net LOC added | N |
| Test LOC (insertions) | N |
| Test LOC ratio | N% |
| Active days | N |
| Detected sessions | N |
| Avg LOC/session-hour | N |

Then show a **per-author leaderboard** immediately below, sorted by commits descending. The current user always appears first, labeled "You (name)".

### Step 3: Commit Time Distribution

Show hourly histogram using bar chart. Identify and call out:
- Peak hours
- Dead zones
- Whether pattern is bimodal (morning/evening) or continuous
- Late-night coding clusters

### Step 4: Work Session Detection

Detect sessions using **45-minute gap** threshold between consecutive commits. For each session:
- Start/end time
- Number of commits
- Duration in minutes

Classify: **Deep sessions** (50+ min), **Medium** (20-50 min), **Micro** (<20 min).

Calculate: Total active coding time, average session length, LOC per hour of active time.

### Step 5: Commit Type Breakdown

Categorize by conventional commit prefix (feat/fix/refactor/test/chore/docs). Show as percentage bar.

Flag if fix ratio exceeds 50% — signals a "ship fast, fix fast" pattern that may indicate review gaps.

### Step 6: Hotspot Analysis

Top 10 most-changed files. Flag:
- Files changed 5+ times (churn hotspots)
- Test files vs production files in the hotspot list

### Step 7: PR Size Distribution

Estimate PR sizes and bucket: **Small** (<100 LOC), **Medium** (100-500), **Large** (500-1500), **XL** (1500+ — flag with file counts).

### Step 8: Focus Score + Ship of the Week

**Focus score:** Percentage of commits touching the single most-changed top-level directory. Higher = deeper focused work.

**Ship of the week:** Auto-identify the single highest-LOC PR. Highlight PR number, title, LOC changed, and why it matters.

### Step 9: Team Member Analysis

For each contributor (including current user), compute:
1. **Commits and LOC** — total commits, insertions, deletions, net LOC
2. **Areas of focus** — top 3 directories/files
3. **Commit type mix** — personal feat/fix/refactor/test breakdown
4. **Session patterns** — peak hours, session count
5. **Test discipline** — personal test LOC ratio
6. **Biggest ship** — single highest-impact commit or PR

**For current user ("You"):** Deepest treatment — full session analysis, time patterns, focus score.

**For each teammate:** 2-3 sentences + **Praise** (1-2 specific things anchored in commits) + **Opportunity for growth** (1 specific, actionable suggestion framed as investment).

**If solo repo:** Skip team breakdown.

**Co-Authored-By trailers:** Credit co-authors. Note AI co-authors (e.g., `noreply@anthropic.com`) but track "AI-assisted commits" as a separate metric, not as team members.

### Step 10: Week-over-Week Trends (if window >= 14d)

Split into weekly buckets: commits, LOC, test ratio, fix ratio, session count per week.

### Step 11: Streak Tracking

```bash
# Team streak: all unique commit dates
git log origin/main --format="%ad" --date=format:"%Y-%m-%d" | sort -u

# Personal streak
git log origin/main --author="<user_name>" --format="%ad" --date=format:"%Y-%m-%d" | sort -u
```

Count backward from today — how many consecutive days have at least one commit?

### Step 12: Load History & Compare

```bash
ls -t .context/retros/*.json 2>/dev/null
```

If prior retros exist, load the most recent one, calculate deltas, and include a **Trends vs Last Retro** section. If none exist, skip comparison and note "First retro recorded — run again next week to see trends."

### Step 13: Save Retro History

```bash
mkdir -p .context/retros
```

Save JSON snapshot with date, window, metrics (commits, contributors, prs_merged, insertions, deletions, net_loc, test_loc, test_ratio, active_days, sessions, deep_sessions, avg_session_minutes, loc_per_session_hour, feat_pct, fix_pct, peak_hour, ai_assisted_commits), authors, streak_days, and tweetable summary.

### Step 14: Write the Narrative

Structure the output as:

---

**Tweetable summary** (first line):
```
Week of Mar 1: 47 commits (3 contributors), 3.2k LOC, 38% tests, 12 PRs, peak: 10pm | Streak: 47d
```

## Engineering Retro: [date range]

### Summary Table (Step 2)
### Trends vs Last Retro (Step 12, if available)
### Time & Session Patterns (Steps 3-4)
### Shipping Velocity (Steps 5-7)
### Code Quality Signals (test ratio, hotspots, XL PRs)
### Focus & Highlights (Step 8)
### Your Week (personal deep-dive for current user)
### Team Breakdown (Step 9, if multi-contributor)
### Top 3 Team Wins
### 3 Things to Improve (specific, actionable, anchored in commits)
### 3 Habits for Next Week (small, practical, <5 min to adopt)
### Week-over-Week Trends (if applicable)

---

## Compare Mode

When `/retro compare` is used:
1. Compute metrics for current window using `--since`
2. Compute metrics for prior same-length window using `--since` and `--until`
3. Show side-by-side comparison with deltas and arrows
4. Narrative highlighting biggest improvements and regressions
5. Save only current-window snapshot

## Tone
- Encouraging but candid, no coddling
- Specific and concrete — anchor in actual commits/code
- Skip generic praise — say exactly what was good and why
- Frame improvements as leveling up, not criticism
- Praise should feel like something you'd say in a 1:1
- Never compare teammates negatively
- ~3000-4500 words
- Output directly to conversation — only file written is `.context/retros/` JSON snapshot

## Important Rules
- ALL narrative output goes to the user. Only file written is the JSON snapshot.
- Use `origin/main` for all git queries (not local main which may be stale)
- If window has zero commits, say so and suggest a different window
- Round LOC/hour to nearest 50
- Treat merge commits as PR boundaries
