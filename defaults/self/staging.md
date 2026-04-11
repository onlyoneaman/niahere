# Memory Staging

Candidate memories waiting for reinforcement before promotion to `memory.md`.
Auto-managed by the consolidator (which writes candidates after chat sessions)
and the nightly `memory-promoter` job (which reviews and promotes).

## How it works

- The consolidator appends candidates here after chat sessions — one line per
  candidate, tagged with a type and a count.
- If a candidate is observed in another session, the consolidator bumps its
  count instead of adding a duplicate.
- The `memory-promoter` job runs nightly at 3am. It promotes candidates with
  `count >= 2` that pass durability review to `memory.md` (or `rules.md` for
  behavioral corrections), and reaps entries older than 14 days that never
  reached count 2.

## Entry format

```
- [count×] [type] content :: first_seen → last_seen
```

- `count` — how many distinct sessions this was observed in
- `type` — one of: `persona | project | reference | correction`
- `content` — the candidate memory, one concise line
- `first_seen` / `last_seen` — ISO dates (YYYY-MM-DD)

## Types

| Type         | What                                                         | Promotes to |
| ------------ | ------------------------------------------------------------ | ----------- |
| `persona`    | Facts about the owner — role, habits, preferences, schedule  | `memory.md` |
| `project`    | Active work decisions, architecture, stakeholders, deadlines | `memory.md` |
| `reference`  | Pointers to external systems (dashboards, repos, channels)   | `memory.md` |
| `correction` | Behavioral preferences the user wants changed                | `rules.md`  |

Anything that doesn't fit these four is not a durable memory — don't stage it.

## Rules

- Do not edit by hand — use the consolidator/promoter flow.
- Entries need `count >= 2` to be eligible for promotion.
- Entries with `count < 2` expire after 14 days of no reinforcement.
- The consolidator writes ONLY to this file — never directly to `memory.md`
  or `rules.md`. Only the promoter can write to the durable files.

---
