---
name: gh-stamp
description: "Stamp a GitHub PR with an LGTM approval comment. Use when someone wants to approve, stamp, or give a thumbs-up to a pull request."
---

# gh-stamp

Approve-stamp a GitHub PR by posting a comment.

## Trigger

User says "stamp", "stamp it", "stmap", or similar.

- Stamp only → use this skill alone.
- Stamp + review → run this skill first, then the pr-reviewer skill.
- Review only → use the pr-reviewer skill, not this.

## Steps

1. **Find the PR.** Accept a full URL, `owner/repo#number`, or a bare number if the repo is obvious from context. If unclear, ask and stop.
2. **Post the comment.**
   ```sh
   gh pr comment <pr-url-or-number> --body "LGTM, Stamped ✅"
   # or with repo qualifier:
   gh pr comment --repo <owner/repo> <number> --body "LGTM, Stamped ✅"
   ```
3. **Confirm to user:** `LGTM, Stamped ✅`

Do not touch anything else on the PR.
