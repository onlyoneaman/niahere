# Playwright MCP Best Practices

## Announce

"Using the playwright-guide skill for effective browser automation."

## How Playwright Works Here

Playwright is available as **MCP tools already in your tool list**. You do NOT need to:
- Install anything (`npm install playwright`, `npx playwright install` — NO)
- Import or require playwright in code
- Write scripts or launch a browser manually
- Use `browser_run_code` to launch — the browser auto-launches

**Just call the tools directly.** They are prefixed `mcp__plugin_playwright_playwright__` in your tool list (e.g., `mcp__plugin_playwright_playwright__browser_navigate`). Search your available tools for `browser_` to see them all.

A persistent Chrome profile at `~/.shared/playwright-profile/` is pre-configured with saved logins. The browser launches automatically on your first tool call and reuses this profile.

## Quickstart: Open a Browser

Call `browser_navigate` with a URL. The browser launches automatically:

```
Tool: mcp__plugin_playwright_playwright__browser_navigate
Parameters: { "url": "https://example.com" }
```

That's it. The browser opens, navigates, and returns a page snapshot you can read and act on.

## The Ref System (Critical)

Every `browser_snapshot` returns an accessibility tree where interactive elements have **ref** attributes:

```yaml
- button "Submit" [ref=e42] [cursor=pointer]
- combobox "Search" [ref=e54]
- link "Home" [ref=e12]
```

**To interact with any element, pass its `ref` value** to click/type/hover tools:

```
Tool: browser_click
Parameters: { "ref": "e42", "element": "Submit button" }
```

**Rules:**
- Refs change on every page update — always use refs from your MOST RECENT snapshot
- Never guess or reuse stale refs — take a fresh snapshot if the page changed
- The `element` parameter is a human-readable description (for logging), `ref` is what actually targets the element

## Tool Reference

All tools are prefixed `mcp__plugin_playwright_playwright__` in your tool list. For example, `browser_navigate` = `mcp__plugin_playwright_playwright__browser_navigate`. Below uses short names for readability — **always use the full prefixed name when calling tools.**

### Navigation & Page State

| Tool | Required Parameters | Purpose |
|------|-------------------|---------|
| `browser_navigate` | `url: string` | Go to URL (launches browser if needed) |
| `browser_navigate_back` | _(none)_ | Go back in history |
| `browser_snapshot` | _(none)_ | Get accessibility tree with refs — **primary way to read the page** |
| `browser_take_screenshot` | `type: "png" \| "jpeg"` | Visual-only capture (can't interact from this) |
| `browser_wait_for` | `text`, `textGone`, OR `time` (at least one) | Wait for content to appear/disappear/timeout |
| `browser_close` | _(none)_ | Close browser, free resources |

### Interaction

| Tool | Required Parameters | Purpose |
|------|-------------------|---------|
| `browser_click` | `ref: string` | Click element (get ref from snapshot) |
| `browser_type` | `ref: string`, `text: string` | Type into a field |
| `browser_fill_form` | `fields: [{name, type, ref, value}]` | Fill multiple fields at once |
| `browser_select_option` | `ref: string`, `values: string[]` | Select dropdown option(s) |
| `browser_hover` | `ref: string` | Hover over element |
| `browser_press_key` | `key: string` | Press keyboard key (e.g. `"Enter"`, `"ArrowDown"`) |
| `browser_drag` | `startRef`, `startElement`, `endRef`, `endElement` | Drag and drop |
| `browser_file_upload` | `paths: string[]` | Upload file(s) |
| `browser_handle_dialog` | `accept: boolean` | Accept/dismiss browser dialog |

### Data Extraction & Debugging

| Tool | Required Parameters | Purpose |
|------|-------------------|---------|
| `browser_evaluate` | `function: string` | Run JS on page — most efficient for data extraction |
| `browser_console_messages` | `level: string` | Get console logs (`"error"`, `"warning"`, `"info"`, `"debug"`) |
| `browser_network_requests` | `includeStatic: boolean` | Inspect network activity |
| `browser_tabs` | `action: "list" \| "new" \| "close" \| "select"` | Manage browser tabs |
| `browser_run_code` | `code: string` | Run arbitrary Playwright JS snippet |

## Core Workflow

```
1. browser_navigate  → open page (browser launches automatically)
2. browser_snapshot   → read page structure, get refs
3. browser_click/type → interact using refs from step 2
4. browser_snapshot   → read updated page, get NEW refs
5. Repeat 3-4
```

**Always snapshot before interacting.** You need fresh refs.

## Tool Selection Rules

### Always prefer `browser_snapshot` over `browser_take_screenshot`

- Snapshots return the **accessibility tree** (structured text) — small, parseable, actionable
- Screenshots return **images** — large, eat tokens fast, and you can't interact based on them
- Only use `browser_take_screenshot` when you need **visual verification** (layout, colors, images)

### Use `browser_fill_form` for multiple fields, not sequential `browser_type`

- `browser_fill_form` handles multiple fields in one call — fewer round-trips, fewer tokens
- Each field object needs: `name` (human label), `type` ("textbox"/"checkbox"/"radio"/"combobox"/"slider"), `ref` (from snapshot), `value` (string)

### Use `browser_wait_for` before reading dynamic content

- SPAs and JS-heavy pages need time to load
- Wait for a known text element before snapshotting
- Prefer text-based waits over time-based waits

### Use `browser_evaluate` for data extraction

- When you need counts, specific values, or structured data from a page
- More efficient than parsing large accessibility trees
- Example: `{ "function": "() => document.querySelectorAll('.item').length" }`

## Concrete Examples

### Example: Navigate, snapshot, click a link

```
1. browser_navigate   → { "url": "https://example.com" }
2. (read snapshot in response — find link ref, e.g. ref=e12)
3. browser_click      → { "ref": "e12", "element": "About link" }
```

### Example: Fill a login form

```
1. browser_navigate   → { "url": "https://app.example.com/login" }
2. browser_snapshot   → (find email field ref=e20, password ref=e25, submit ref=e30)
3. browser_fill_form  → { "fields": [
     { "name": "Email", "type": "textbox", "ref": "e20", "value": "user@example.com" },
     { "name": "Password", "type": "textbox", "ref": "e25", "value": "secret" }
   ]}
4. browser_click      → { "ref": "e30", "element": "Login button" }
5. browser_wait_for   → { "text": "Dashboard" }
```

### Example: Extract data without snapshotting

```
1. browser_navigate   → { "url": "https://example.com/products" }
2. browser_wait_for   → { "text": "Products" }
3. browser_evaluate   → { "function": "() => [...document.querySelectorAll('.product')].map(p => ({ name: p.querySelector('h2').textContent, price: p.querySelector('.price').textContent }))" }
```

## Handling Large Pages

Large pages (e-commerce listings, dashboards, feeds) produce snapshots that **exceed token limits**.

### Strategy 1: Wait then evaluate (preferred)

```
1. browser_navigate → go to page
2. browser_wait_for → wait for content
3. browser_evaluate → extract specific data with JS
```

Skip the snapshot entirely — go straight to evaluation.

### Strategy 2: Snapshot to file, then grep

When the snapshot is too large, it auto-saves to a file. Use Grep on the saved file to find specific elements.

### Strategy 3: Narrow the page first

- Use filters, search, or navigation to reduce content before snapshotting
- Click category filters, date filters, pagination
- Smaller page = smaller snapshot = fewer tokens

## Session Management & Persistent Chrome Profile

### Profile Location
- **Persistent profile**: `~/.shared/playwright-profile/` — cookies, logins, and browser state persist across sessions and agents
- **Config**: `~/.shared/playwright-config.json` — controls browser type, headless mode, and profile path
- **MCP registration**: `~/.claude/plugins/.../playwright/.mcp.json` — must include `--config` flag pointing to the config file

### How It Works
- Playwright launches a **separate Chrome instance** using the persistent profile — won't conflict with your running Chrome
- Log in manually once in the Playwright Chrome window (e.g., App Store Connect, RevenueCat), sessions persist across restarts and new conversations
- Any agent or session that uses Playwright MCP shares the same profile — no re-login needed

### If Sessions Expire or Browser Won't Connect
- **"Opening in existing browser session" error**: A Chrome instance with this profile is already running. Find and kill it:
  ```bash
  ps aux | grep "user-data-dir=/Users/aman/.shared/playwright-profile" | grep -v grep | grep -v "Helper" | awk '{print $2}' | xargs kill
  ```
  Then retry the Playwright action. The persistent profile (cookies/logins) is on disk and survives browser restarts.
- **Auth expired?** Navigate to the login page in the Playwright Chrome window and re-login — the new session will persist automatically.
- **Random cache profiles**: If Chrome uses `/Library/Caches/ms-playwright/mcp-chrome-*` instead of the persistent profile, the `--config` flag is missing from the MCP registration. Fix: ensure `~/.claude/plugins/.../playwright/.mcp.json` includes `"--config", "/Users/aman/.claude/playwright-config.json"` in the args array.

### Logged-In Services (as of Feb 2026)
- Apple App Store Connect (`appstoreconnect.apple.com`)
- RevenueCat (`app.revenuecat.com`)

## Token Budget Awareness

| Action | Approximate Token Cost |
|--------|----------------------|
| `browser_snapshot` (simple page) | 1-3k tokens |
| `browser_snapshot` (complex page) | 10-50k+ tokens |
| `browser_take_screenshot` | 5-15k tokens |
| `browser_evaluate` (return value) | 200-500 tokens |
| `browser_click` / `browser_type` | 1-5k tokens (includes changed snapshot) |
| `browser_wait_for` | 1-5k tokens (includes snapshot) |

**Rule of thumb:** If you're doing 10+ browser actions, you're spending 30-100k+ tokens. Be intentional.

## Anti-Patterns

| Don't | Do Instead |
|-------|-----------|
| Screenshot then ask "what do you see?" | Snapshot and read the accessibility tree |
| Click by coordinates or pixel position | Click by `ref` from snapshot |
| Guess or reuse old refs | Always take fresh snapshot for current refs |
| Snapshot a massive page to "see everything" | Evaluate with JS to extract specific data |
| Type into fields one by one | Use `browser_fill_form` for batch fills |
| Navigate without waiting | Always `wait_for` before reading content |
| Keep browser open indefinitely | Close when done to free resources |
| Ignore snapshot file saves | Grep/parse the saved file for large outputs |
| Try to launch/setup browser manually | Just call `browser_navigate` — it auto-launches |

## Debugging Tips

- **Page not loading?** Check `browser_console_messages` with `level: "error"` for JS errors
- **Element not found?** Take a fresh `browser_snapshot` — the page may have changed
- **Auth expired?** Navigate to the login page in the Playwright Chrome window and re-login
- **Network issues?** Use `browser_network_requests` with `includeStatic: false` to inspect failed API calls
- **Wrong page state?** Use `browser_navigate_back` or re-navigate to reset
- **Stale refs?** Refs expire on page change — take a new snapshot
