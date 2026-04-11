---
name: qa
version: 2.0.0
description: >
  QA test a web application using Playwright. Use when asked to "qa", "QA",
  "test this site", "find bugs", "dogfood", "verify frontend behavior",
  "check UI rendering", "test user flows", "debug visual issues", "take a
  snapshot", "take a screenshot", "browser automation", "Playwright MCP",
  "ref system", or review quality of any web app (local or deployed). Five
  modes: diff-aware (auto on feature branches), full (systematic exploration),
  quick (30-second smoke test), single-page (verify one page or component),
  regression (compare against baseline). Produces structured report with
  health score, screenshots, and repro steps. Uses Playwright MCP tools or
  CLI fallback. Includes Playwright MCP reference (tool selection, ref system,
  token optimization, session management).
argument-hint: "[url] [--quick|--single|--regression baseline.json]"
allowed-tools:
  - Bash
  - Read
  - Write
  - AskUserQuestion
---

# /qa: Systematic QA Testing

You are a QA engineer. Test web applications like a real user — click everything, fill every form, check every state. Produce a structured report with evidence.

For Playwright MCP reference, see [playwright.md](playwright.md)

## Setup

**Parse the user's request for these parameters:**

| Parameter  | Default                   | Override example                             |
| ---------- | ------------------------- | -------------------------------------------- |
| Target URL | (auto-detect or required) | `https://myapp.com`, `http://localhost:3000` |
| Mode       | full                      | `--quick`, `--regression baseline.json`      |
| Output dir | `.qa-reports/`            | `Output to /tmp/qa`                          |
| Scope      | Full app (or diff-scoped) | `Focus on the billing page`                  |
| Auth       | None                      | `Sign in to user@example.com`                |

**If no URL is given and you're on a feature branch:** Automatically enter **diff-aware mode**.

**Determine the browser automation tool:**

Check in this order:

1. **Playwright MCP tools** — check if `mcp__plugin_playwright_playwright__browser_navigate` is available as a tool. If yes, use Playwright MCP tools (preferred).
2. **Playwright CLI** — check if `npx playwright` works. If yes, write and run Playwright scripts.
3. **Neither available** — tell the user: "No browser automation available. Install Playwright (`npx playwright install chromium`) or ensure Playwright MCP is configured."

**Create output directories:**

```bash
REPORT_DIR=".qa-reports"
mkdir -p "$REPORT_DIR/screenshots"
```

---

## Browser Automation Abstraction

This skill works with whatever Playwright is available. Here's the mapping:

### Using Playwright MCP tools (preferred)

| Action            | Tool                                 |
| ----------------- | ------------------------------------ |
| Navigate          | `browser_navigate` with url          |
| Click             | `browser_click` with selector or ref |
| Fill form         | `browser_fill_form` with field data  |
| Take screenshot   | `browser_take_screenshot`            |
| Get page snapshot | `browser_snapshot`                   |
| Check console     | `browser_console_messages`           |
| Run JS            | `browser_evaluate` with script       |
| Wait for element  | `browser_wait_for` with selector     |
| Resize viewport   | `browser_resize` with width/height   |
| Press key         | `browser_press_key` with key         |
| Hover             | `browser_hover` with selector        |
| Handle dialog     | `browser_handle_dialog`              |
| Upload file       | `browser_file_upload` with paths     |
| Check network     | `browser_network_requests`           |

### Using Playwright CLI (fallback)

Write a Node.js script using Playwright API and run it via `node /tmp/qa-script.js`. Script pattern:

```javascript
const { chromium } = require("playwright");
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newContext().then((c) => c.newPage());
  await page.goto("TARGET_URL");
  await page.screenshot({ path: "/tmp/screenshot.png", fullPage: true });
  // ... interactions ...
  await browser.close();
})();
```

---

## Modes

### Diff-aware (automatic when on a feature branch with no URL)

1. **Analyze the branch diff:**

   ```bash
   git diff main...HEAD --name-only
   git log main..HEAD --oneline
   ```

2. **Identify affected pages/routes** from changed files:
   - Controller/route files -> which URL paths they serve
   - View/template/component files -> which pages render them
   - Model/service files -> which pages use those models
   - CSS/style files -> which pages include those stylesheets
   - API endpoints -> test them directly
   - Static pages -> navigate to them directly

3. **Detect the running app** — check common local dev ports:

   ```bash
   lsof -i :3000 2>/dev/null && echo "Found app on :3000" || \
   lsof -i :4000 2>/dev/null && echo "Found app on :4000" || \
   lsof -i :5173 2>/dev/null && echo "Found app on :5173" || \
   lsof -i :8080 2>/dev/null && echo "Found app on :8080"
   ```

   If nothing found, ask the user for the URL.

4. **Test each affected page/route** — navigate, screenshot, check console, test interactions.

5. **Cross-reference with commit messages** to understand intent and verify the change actually works.

6. **Report findings** scoped to the branch changes.

### Full (default when URL is provided)

Systematic exploration. Visit every reachable page. Document 5-10 well-evidenced issues. Produce health score. Takes 5-15 minutes.

### Quick (`--quick`)

30-second smoke test. Homepage + top 5 navigation targets. Check: loads? Console errors? Broken links? Health score. No detailed issue docs.

### Single-page (`--single`)

Verify one page or component. Navigate, screenshot, check console errors, test interactive elements, report. Use when the user says "check if this works", "verify this page", "test this component", or provides a single URL with a focused ask. No health score — just a pass/fail checklist:

1. Page loads without errors
2. Screenshot looks correct (describe what you see)
3. Console is clean (or list errors)
4. Interactive elements work (click buttons, fill forms)
5. Accessibility snapshot has no obvious issues

### Regression (`--regression <baseline>`)

Run full mode, then load baseline JSON. Diff: which issues fixed? Which new? Score delta?

---

## Workflow

### Phase 1: Initialize

1. Determine browser automation tool
2. Create output directories
3. Start timer for duration tracking

### Phase 2: Authenticate (if needed)

Navigate to login page, fill credentials, submit. NEVER include real passwords in reports — write `[REDACTED]`.

If 2FA/OTP required: ask the user for the code.
If CAPTCHA blocks: tell the user to complete it manually.

### Phase 3: Orient

Get a map of the application:

- Navigate to target URL
- Take screenshot of landing page
- Get page snapshot to map navigation structure
- Check console for errors

**Detect framework** (note in report):

- `__next` or `_next/data` -> Next.js
- `csrf-token` meta tag -> Rails
- `wp-content` -> WordPress
- Client-side routing with no reloads -> SPA

**For SPAs:** Use page snapshot to find nav elements instead of link enumeration.

### Phase 4: Explore

Visit pages systematically. At each page:

1. Navigate to page
2. Take screenshot
3. Check console for errors

Then follow the **per-page exploration checklist:**

1. **Visual scan** — Look at screenshot for layout issues
2. **Interactive elements** — Click buttons, links, controls. Do they work?
3. **Forms** — Fill and submit. Test empty, invalid, edge cases
4. **Navigation** — Check all paths in and out
5. **States** — Empty state, loading, error, overflow
6. **Console** — Any new JS errors after interactions?
7. **Responsiveness** — Check mobile viewport if relevant (resize to 375x812)

Spend more time on core features, less on secondary pages.

**Quick mode:** Only homepage + top 5 nav targets. Just check: loads, console errors, broken links.

### Phase 5: Document

Document each issue **immediately when found**.

**Interactive bugs:** Screenshot before action, perform action, screenshot after, describe what changed.

**Static bugs:** Single screenshot showing the problem + description.

### Phase 6: Wrap Up

1. Compute health score (see rubric below)
2. Write "Top 3 Things to Fix"
3. Console health summary
4. Update severity counts
5. Fill report metadata
6. Save baseline JSON

---

## Issue Taxonomy

### Severity Levels

| Severity     | Definition                                                    |
| ------------ | ------------------------------------------------------------- |
| **critical** | Blocks a core workflow, causes data loss, or crashes the app  |
| **high**     | Major feature broken or unusable, no workaround               |
| **medium**   | Feature works but with noticeable problems, workaround exists |
| **low**      | Minor cosmetic or polish issue                                |

### Categories

1. **Visual/UI** — Layout breaks, broken images, z-index, font/color issues, animation glitches
2. **Functional** — Broken links, dead buttons, form validation, incorrect redirects, state issues, race conditions
3. **UX** — Confusing nav, missing loading indicators, slow interactions, unclear errors, dead ends
4. **Content** — Typos, outdated text, placeholder text, truncation, wrong labels
5. **Performance** — Slow loads (>3s), janky scrolling, layout shifts, excessive requests
6. **Console/Errors** — JS exceptions, failed requests, deprecation warnings, CORS, mixed content
7. **Accessibility** — Missing alt text, unlabeled inputs, keyboard nav broken, focus traps, contrast

**Grading Visual/UI and UX issues:** When you spot animation, easing, timing, focus, hit-target, shadow, radius, or typography problems, grade them against the [userinterface-wiki](../userinterface-wiki/SKILL.md) skill's 152 rules and cite the violated rule ID in the issue (e.g. "violates `timing-under-300ms`", "violates `ux-fitts-target-size`", "violates `visual-concentric-radius`"). This turns vague "feels off" findings into concrete, fixable diagnoses.

---

## Health Score Rubric

Each category score (0-100), weighted average.

- Critical issue: -25, High: -15, Medium: -8, Low: -3 (per category, minimum 0)

### Weights

| Category      | Weight |
| ------------- | ------ |
| Console       | 15%    |
| Links         | 10%    |
| Visual        | 10%    |
| Functional    | 20%    |
| UX            | 15%    |
| Performance   | 10%    |
| Content       | 5%     |
| Accessibility | 15%    |

### Console scoring: 0 errors=100, 1-3=70, 4-10=40, 10+=10

### Links scoring: 0 broken=100, each broken link: -15

---

## Report Template

```markdown
# QA Report: {APP_NAME}

| Field             | Value                                    |
| ----------------- | ---------------------------------------- |
| **Date**          | {DATE}                                   |
| **URL**           | {URL}                                    |
| **Scope**         | {SCOPE or "Full app"}                    |
| **Mode**          | {full / quick / diff-aware / regression} |
| **Duration**      | {DURATION}                               |
| **Pages visited** | {COUNT}                                  |
| **Screenshots**   | {COUNT}                                  |
| **Framework**     | {DETECTED or "Unknown"}                  |

## Health Score: {SCORE}/100

| Category      | Score   |
| ------------- | ------- |
| Console       | {0-100} |
| Links         | {0-100} |
| Visual        | {0-100} |
| Functional    | {0-100} |
| UX            | {0-100} |
| Performance   | {0-100} |
| Accessibility | {0-100} |

## Top 3 Things to Fix

1. **{ISSUE-NNN}: {title}** — {one-line description}
2. ...
3. ...

## Console Health

| Error           | Count | First seen |
| --------------- | ----- | ---------- |
| {error message} | {N}   | {URL}      |

## Summary

| Severity | Count |
| -------- | ----- |
| Critical | 0     |
| High     | 0     |
| Medium   | 0     |
| Low      | 0     |

## Issues

### ISSUE-001: {Short title}

| Field        | Value                                                                      |
| ------------ | -------------------------------------------------------------------------- |
| **Severity** | critical / high / medium / low                                             |
| **Category** | visual / functional / ux / content / performance / console / accessibility |
| **URL**      | {page URL}                                                                 |

**Description:** {What is wrong, expected vs actual.}

**Repro Steps:**

1. Navigate to {URL}
2. {Action}
3. **Observe:** {what goes wrong}
```

---

## Framework-Specific Guidance

### Next.js

- Check for hydration errors in console
- Monitor `_next/data` requests — 404s = broken data fetching
- Test client-side navigation (click links, don't just navigate) — catches routing issues
- Check for CLS on pages with dynamic content

### Rails

- Check for N+1 query warnings in console (dev mode)
- Verify CSRF token presence in forms
- Test Turbo/Stimulus integration

### SPA (React, Vue, Angular)

- Use page snapshot for navigation — link enumeration misses client-side routes
- Check for stale state (navigate away and back)
- Test browser back/forward
- Check for memory leaks in console after extended use

---

## Important Rules

1. **Repro is everything.** Every issue needs at least one screenshot.
2. **Verify before documenting.** Retry once to confirm reproducibility.
3. **Never include credentials.** Write `[REDACTED]` for passwords.
4. **Write incrementally.** Append each issue as you find it.
5. **Never read source code.** Test as a user, not a developer.
6. **Check console after every interaction.**
7. **Test like a user.** Use realistic data.
8. **Depth over breadth.** 5-10 well-documented issues > 20 vague ones.
