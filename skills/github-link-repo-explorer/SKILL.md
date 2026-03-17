---
name: github-link-repo-explorer
description: Explore a GitHub repository from a link by cloning locally first, then inspecting files and history. Use when a task includes a GitHub repo URL or owner/repo and code-level analysis is needed. Prefer local clone into /tmp before using web pages.
---

## GitHub Link Repo Explorer

Explore repositories from GitHub links with a local-first workflow.

## Core Rule

Always try local clone before web browsing.

- Clone target: `/tmp/<repo-name>`
- Always run clone/update commands from `/tmp` (`cd /tmp` first).
- If directory exists, update it (`git fetch --all --prune`) or reclone if corrupted.
- Use web fallback only when clone/auth/network access fails.
- Do not start with web exploration when a local clone attempt is possible.

## Inputs

Accept any of:
- full URL: `https://github.com/<owner>/<repo>`
- SSH URL: `git@github.com:<owner>/<repo>.git`
- short form: `<owner>/<repo>`

Normalize input to:
- `owner`
- `repo`
- `clone_url`
- `local_path=/tmp/<repo>`

## Workflow

### 1. Prepare local checkout

1. Parse owner/repo from input.
2. Set `local_path` to `/tmp/<repo>`.
3. Change working directory to `/tmp`.
4. Clone if missing:
   - `cd /tmp && git clone --filter=blob:none <clone_url> <repo>`
5. If present, refresh:
   - `cd /tmp/<repo> && git fetch --all --prune`

### 2. Establish repository context

Run quick context commands:
- `git -C /tmp/<repo> remote -v`
- `git -C /tmp/<repo> branch -a`
- `git -C /tmp/<repo> log --oneline -n 20`
- `rg --files /tmp/<repo>` (or equivalent)

Identify:
- default branch
- primary language and build system
- key entry points and docs (`README`, `docs/`, configs)

### 3. Perform the requested analysis

Prefer direct file inspection over assumptions:
- locate with `rg`
- read targeted files only
- cite exact file paths and relevant lines
- run project checks/tests only if needed and safe

### 4. Keep output actionable

Return:
- what was inspected
- findings with file references
- unresolved gaps
- next concrete checks

## Fallbacks

If clone fails:
1. Report exact failure reason (auth, not found, network, rate limits).
2. Retry clone from `/tmp` using alternate URL form (HTTPS vs SSH) if appropriate.
3. If still blocked, use web exploration of GitHub pages for limited analysis.
4. Clearly mark web-derived conclusions as lower confidence than local checkout results.

## Safety and Efficiency

- Do not modify the cloned repository unless explicitly requested.
- Avoid broad recursive reads when targeted search is sufficient.
- Remove or reuse stale `/tmp/<repo>` directories carefully.
- Prefer shallow/sparse strategies when full history is unnecessary.

## Quick Command Template

```bash
REPO_INPUT="https://github.com/owner/repo"
OWNER_REPO="$(printf '%s' "$REPO_INPUT" | sed -E 's#(git@github.com:|https://github.com/)##; s#\.git$##')"
REPO_NAME="${OWNER_REPO##*/}"
LOCAL_PATH="/tmp/$REPO_NAME"

cd /tmp
if [ ! -d "$LOCAL_PATH/.git" ]; then
  git clone --filter=blob:none "https://github.com/$OWNER_REPO.git" "$REPO_NAME"
else
  cd "$LOCAL_PATH"
  git fetch --all --prune
fi
```
