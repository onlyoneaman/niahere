# Multi-Agent Philosophy

## Our Position

**One agent, well-prompted, with good tools beats a swarm of specialized agents for almost everything.**

Nia is a single-agent system by design. We don't have a "marketing agent" and a "coding agent" and a "research agent" — we have Nia, with skills, jobs, and MCP tools. This is not a limitation. It's a deliberate architectural choice backed by research, practitioner consensus, and our own experience.

## Why Not Multi-Agent

### The research says so

**Google DeepMind (Dec 2025)** tested multi-agent systems rigorously and found:

- Unstructured multi-agent networks **amplify errors up to 17.2x** vs single-agent baselines
- On sequential tasks, multi-agent **dropped performance by up to 70%**
- The "bag of agents" pattern (throwing agents together) is actively harmful

> Rule of thumb: if a single agent solves more than 45% of a task correctly, multi-agent usually isn't worth it.

**The MAST study** analyzed 1,642 execution traces across 7 open-source multi-agent frameworks and found **failure rates from 41% to 86.7%**, with coordination breakdowns comprising 36.9% of all failures. Gains plateau beyond 4 agents.

**Cognition Labs** (makers of Devin, the most advanced coding agent) published "Don't Build Multi-Agents":

> Sub-agents operating in silos have no context of each other's work, leading to brittle systems. A single agent with good context engineering is more reliable for deep tasks.

### Most "multi-agent" is just prompt switching

OpenAI's Agents SDK "handoffs" are literally: swap the system prompt, swap the tool list, continue the same conversation loop. One LLM at a time, serial. The "agents" are configurations, not independent entities.

Even Claude's Agent SDK subagents — which are more real (fresh context windows, parallel execution) — are single-level only. No agent-to-agent communication. The parent spawns, the child returns a result. That's delegation, not collaboration.

> "Multi-agent is a scaling strategy, not an intelligence strategy — it doesn't make the AI smarter, it makes it faster at parallelizable work."

### The practitioner consensus

From Hacker News, Reddit, and production teams building with CrewAI, AutoGen, LangGraph:

- **"Picking the wrong framework costs weeks of refactoring"**
- **"Half-baked agents in a half-baked organization"** — if individual agents are unreliable, orchestrating many compounds failures
- Most practitioners building production systems end up writing custom orchestration rather than fighting multi-agent framework abstractions

Anthropic's own "Building Effective Agents" guide (Dec 2024) said it plainly:

> "For many applications, optimizing single LLM calls with retrieval and in-context examples is usually enough."

## What We Do Instead

### The Spectrum: Skills → Agents → Subagents

Niahere has three levels of specialization, each solving a different problem:

```
Skills              Agents              Subagents
────────────────    ────────────────    ────────────────
Knowledge           Identity + Role     Parallel delegation
"How to do X"       "Be X, do Y"       "Go do X, report back"
Stateless           Scheduled           Ephemeral
On-demand           Autonomous          On-demand
Same context        Same Nia            Fresh context
```

### Skills — Knowledge injection

Skills are specialized instructions loaded into Nia's context. They teach Nia *how* to do something without changing who Nia is.

```
~/.niahere/skills/pr-reviewer/SKILL.md
~/.niahere/skills/image-generation/SKILL.md
```

Format: YAML frontmatter (`name`, `description`) + markdown body. Discovered by scanning `skills/` directories. Surfaced in the system prompt as `/skillname`.

Use skills when: the task needs specialized knowledge but doesn't need a persistent role, schedule, or different model.

### Agents — Domain specialists via SDK subagents

Agents are role/domain-specialized `AGENT.md` files passed to the Claude Agent SDK as native subagents. The SDK handles routing, spawning, and context isolation — we just scan the files and pass them to `query()`.

```
agents/marketer/AGENT.md
agents/senior-dev/AGENT.md
~/.niahere/agents/ops/AGENT.md
```

Format follows Claude Code's agent definition: YAML frontmatter (`name`, `description`, optional `model`) + markdown body (the prompt).

```yaml
---
name: marketer
description: Marketing specialist for content strategy, social media copy, brand voice.
  Use when the task involves writing copy, drafting posts, or marketing analysis.
model: sonnet
---

You are a marketing specialist working for Aman.
...domain knowledge, voice guidelines, audience context...
```

**How it works:**

| Context | Mechanism |
|---------|-----------|
| **Chat** | Agent definitions passed to SDK's `agents` param in `query()`. SDK decides when to delegate based on `description`. Agent runs in fresh context, returns result to Nia. |
| **Jobs** | `nia job add blog "0 9 * * *" "Write a post" --agent marketer` — agent body becomes the job's system prompt. Agent model respected. |
| **MCP** | `list_agents` tool lets Nia see available agents at runtime. |

**Frontmatter fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | yes | Identifier (lowercase, hyphens). Must be unique. |
| `description` | string | yes | When to use this agent. SDK uses this for routing. |
| `model` | string | no | Model override (`haiku`, `sonnet`, `opus`). Default: inherit. |

**Discovery:** Scanned from `agents/` directories (project, `~/.niahere/agents/`, `~/.shared/agents/`). Same pattern as skills scanner. First match wins for deduplication.

**Key constraints (by design):**
- **Single-level only** — subagents cannot spawn their own subagents
- **Fresh context** — subagents don't see the parent conversation
- **Result only** — parent receives the subagent's final message, not its internal reasoning
- **Nia decides** — the main agent chooses when to delegate based on the description

## How It All Connects

```
User says "write a Twitter thread" on Telegram
  → Nia sees marketer agent description matches
  → SDK spawns marketer as subagent (fresh context)
  → Marketer drafts the thread
  → Result returns to Nia → sent to user

Job runs with --agent marketer (Monday 9am)
  → Agent body loaded as systemPrompt
  → Job prompt passed as user message
  → Agent model (sonnet) used for the run
  → Result sent to configured channel
```

## The Decision Framework

Before reaching for multi-agent, ask:

1. **Can a skill handle this?** Skills inject specialized knowledge without creating a new entity. Almost always sufficient.
2. **Can an agent handle this?** Agent files give Nia a domain specialist to delegate to — via chat or scheduled jobs.
3. **Are the subtasks genuinely independent?** If they need to share context or coordinate, single-agent is better.
4. **Would parallel execution actually help?** If tasks are sequential, subagents add latency, not speed.

## CLI Surface

```bash
nia agent list              # List all available agents
nia agent show marketer     # Show agent details and prompt
nia job add blog "0 9 * * *" "Write a post" --agent marketer  # Job with agent
```

## References

- [Don't Build Multi-Agents — Cognition Labs](https://cognition.ai/blog/dont-build-multi-agents)
- [Building Effective Agents — Anthropic](https://www.anthropic.com/research/building-effective-agents)
- [More AI agents isn't always better — Google DeepMind / The Decoder](https://the-decoder.com/more-ai-agents-isnt-always-better-new-google-and-mit-study-finds/)
- [The Multi-Agent Trap — Towards Data Science](https://towardsdatascience.com/the-multi-agent-trap/)
- [Why Your Multi-Agent System is Failing: The 17x Error Trap — Towards Data Science](https://towardsdatascience.com/why-your-multi-agent-system-is-failing-escaping-the-17x-error-trap-of-the-bag-of-agents/)
- [Claude Agent SDK: Subagents — Anthropic](https://platform.claude.com/docs/en/agent-sdk/subagents)
- [Single vs Multi-Agent Systems — Phil Schmid](https://www.philschmid.de/single-vs-multi-agents)
- [Claude Code: Custom Subagents — Anthropic](https://code.claude.com/docs/en/sub-agents)
- [OpenAI Agents SDK: Handoffs](https://openai.github.io/openai-agents-python/handoffs/)

---

*This document reflects our position as of March 2026. Models and tooling evolve — if SDK subagent capabilities become substantially more reliable, we'll revisit. But the burden of proof is on multi-agent, not single-agent.*
