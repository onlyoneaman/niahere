# Employee System Design

## Overview

Employees are persistent, goal-driven entities that live inside Nia. Unlike agents (role prompts for delegation) or skills (knowledge injection), an employee is an autonomous principal — it has identity, memory, goals, and the authority to create work (jobs, sub-employees, agents) within its scoped project.

## Data Model

### EmployeeInfo Type

```typescript
interface EmployeeInfo {
  name: string;
  project: string; // Human label e.g. "aicodeusage.com"
  repo: string; // Absolute path to project repo
  role: string; // e.g. "Chief of Staff"
  model?: string; // Model override (opus, sonnet, haiku)
  status: "onboarding" | "active" | "paused";
  maxSubEmployees: number; // Default 3
  body: string; // Prompt body from EMPLOYEE.md
  created: string; // ISO date
  parent?: string; // Parent employee name (for sub-employees)
}
```

### Directory Structure

```
~/.niahere/employees/
  james/
    EMPLOYEE.md              # Identity + config (YAML frontmatter + prompt body)
    memory.md                # What James has learned, decided, observed
    goals.md                 # Current goals and success criteria
    org.md                   # Sub-employees and agents James has created
    decisions.md             # Decision log (approved/pending/rejected)
    onboarding/
      brief.md               # What the user told James during onboarding
      discovery.md           # What James found during self-discovery
      plan.md                # James's initial plan (approved by user)
```

### EMPLOYEE.md Format

```yaml
---
name: james
project: aicodeusage.com
repo: /Users/aman/projects/aicodeusage
role: Chief of Staff
model: opus
status: active
maxSubEmployees: 3
created: 2026-04-12
---
[Prompt body — identity, authority, constraints, working style]
```

## Employee Lifecycle

### Phase 1: Creation

`nia employee add james --project aicodeusage.com --repo /path/to/repo`

- Scaffolds `~/.niahere/employees/james/` with EMPLOYEE.md (status: onboarding) and empty state files
- Drops into onboarding chat session automatically

### Phase 2: Onboarding (single session, 3 steps)

**Step A — Brief:** James asks the user about the project, goals, what's working, what's not. Saves to `onboarding/brief.md`.

**Step B — Self-Discovery:** James explores the repo autonomously — reads code, README, recent commits, deployment config, live site if accessible. Saves findings to `onboarding/discovery.md`. Reports back to user for corrections.

**Step C — Initial Plan:** James proposes top 3-5 priorities with first actions for each. Saves to `onboarding/plan.md`. User approves/adjusts. Status flips to `active`.

### Phase 3: Active Operation

Via `nia chat --employee james`. Each session:

1. James loads his full state (memory, goals, decisions, org)
2. Reviews what's changed since last session (git log, job results, pending items)
3. Works autonomously within authority, queues approvals for external actions
4. Updates state files before session ends

### Phase 4: Pause/Resume

```bash
nia employee pause james     # status → paused
nia employee resume james    # status → active
```

## CLI Commands

```
nia employee add <name>           Create employee and start onboarding
  --project <label>               Project name (required)
  --repo <path>                   Project repo path (required)
  --role <role>                   Role title (default: "Chief of Staff")
  --model <model>                 Model override
  --max-sub-employees <n>         Max sub-employees (default: 3)

nia employee list                 List all employees with status
nia employee show <name>          Show employee details and state
nia employee pause <name>         Pause an employee
nia employee resume <name>        Resume a paused employee
nia employee remove <name>        Remove an employee
nia employee approvals [name]     Show pending approvals

nia chat --employee <name>        Open chat session as employee
```

## System Prompt Integration

When `nia chat --employee james` runs:

1. Load EMPLOYEE.md body as the base system prompt
2. Append employee state context:
   - Current goals from goals.md
   - Recent memory from memory.md
   - Pending decisions from decisions.md
   - Org chart from org.md
   - Onboarding context (brief + discovery) for reference
3. Set working directory to employee's repo
4. Inject available tools (job creation, sub-employee management) into prompt

The employee does NOT use Nia's identity files (identity.md, soul.md, etc.). The employee IS its own identity.

## Employee Authority & Tools

Employees can use all standard Nia tools plus:

- Create/manage jobs scoped to their project
- Create sub-employees (up to maxSubEmployees)
- Create agents under their org
- Read/write files in their repo
- Draft content, PRs, deployments

### Approval Queue

For actions requiring approval, the employee writes to `decisions.md`:

```markdown
## [pending] Deploy authentication refactor

**Date:** 2026-04-12
**What:** Merge PR #42 and deploy to production
**Why:** Simplifies auth flow, reduces login errors by ~30%
**Risk:** Medium — touches auth middleware

---
```

User reviews via `nia employee approvals james` or in chat. When approved, employee updates the entry to `[approved]` with date.

## Sub-Employee Creation

When James creates a sub-employee:

```
~/.niahere/employees/
  james/
    ...
  james-writer/              # Sub-employee created by James
    EMPLOYEE.md              # parent: james in frontmatter
    ...
```

Sub-employees:

- Have `parent: james` in their EMPLOYEE.md frontmatter
- Are scoped to the same project as their parent
- Count against the parent's maxSubEmployees limit
- Cannot create their own sub-employees (single level only)
- Can be managed by their parent OR by the user

## What This Does NOT Include

- No new database tables — employee state is file-based
- No daemon changes — employees operate through chat sessions and jobs
- No inter-employee communication — sub-employees are independent, parent coordinates
- No automatic scheduling — employees work when you chat with them (can create their own jobs for async work)
