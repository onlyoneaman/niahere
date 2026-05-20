# Phone Channel — Voice Calling for Nia

**Date:** 2026-05-21
**Status:** Design approved, implementation in progress

## Goal

Add real-time voice calling to Nia so the owner can:

- **Call Nia** from a phone and talk through tasks, memory, and jobs with full context.
- **Receive calls from Nia** for scheduled rituals (morning standup, evening retro), approval pings, and substantive reminders.
- **Have Nia call others** (allowlisted contacts, vendors, appointments) via an MCP tool.

This is exposed as a new channel alongside `telegram` and `slack`, plus one MCP tool (`place_call`) for outbound delegation from jobs and chat.

## Non-goals (v1)

- Open receptionist for unknown callers — phase 2.
- Recording / transcription archiving beyond the final-text transcript — phase 2.
- Multi-party calls, IVR navigation, voicemail traversal — phase 3.

## Stack

- **PSTN:** Twilio Programmable Voice. Number: `+13025480697` (US, voice-enabled).
- **Voice loop:** OpenAI Realtime API (`gpt-realtime`) with `g711_ulaw` codec end-to-end (matches Twilio's native format — no resampling).
- **Brain:** Existing Claude Agent SDK engine, reached from the realtime session via a `consult_claude` tool. Realtime answers conversational turns on its own; defers to Claude only when memory, persona accuracy, or a durable action is needed.
- **Tunnel (dev + Mac Mini deploy):** `cloudflared` named tunnel. Daemon exposes a local HTTP server; cloudflared maps it to a public hostname configured in Twilio's voice webhook.
- **Persistence:** Existing `messages` table with `channel = 'phone'`. One row per finalized call turn, transcript-style.

No Twilio SDK dependency — minimal `fetch` + `crypto.createHmac` for signature validation. Keeps Nia's surface area small.

## Architecture

```
+-----------+    PSTN     +----------+   HTTP(s)   +------------------+   wss   +----------------+
|  Caller   |  <------>   |  Twilio  |  <------->  |  cloudflared     |  <-->   |  nia daemon    |
+-----------+             +----------+             |  tunnel          |         |  (Bun.serve)   |
                              |                    +------------------+         |  HTTP + WS     |
                              |  Media Streams                                  +----------------+
                              |  (wss, g711_ulaw)                                    |
                              +------------------------------------------------------+
                                                                                     |
                                                                              wss to OpenAI
                                                                              Realtime API
                                                                                     |
                                                          +-----------------+        |
                                                          | OpenAI Realtime |  <-----+
                                                          | tool calls -->  | -- consult_claude
                                                          |                 | -- place_action_*
                                                          +-----------------+ -- mcp tools
```

## Components

### `src/channels/phone.ts`

- Implements the `Channel` interface (`start`, `stop`, optional `sendMessage`).
- On `start()`: validates env (`TWILIO_SID`, `TWILIO_SECRET`, `PHONE_FROM_NUMBER`, `PRIMARY_PHONE_USER`, `OPENAI_API_KEY`, `PUBLIC_BASE_URL`, optional `PHONE_PORT`, `PHONE_ALLOWLIST`); boots a Bun HTTP server with three routes and one WebSocket route.
- On `stop()`: closes the server, terminates any active relays.

### HTTP routes (Twilio-facing)

- `POST /twilio/voice/incoming` — TwiML response that opens a `<Stream>` back to our WS endpoint.
- `POST /twilio/voice/status` — call lifecycle webhooks (initiated/answered/completed); persists final transcript.
- `POST /twilio/voice/outbound/<callSid>` — TwiML response used for outbound calls; same `<Stream>` open.

All three validate `X-Twilio-Signature` against `TWILIO_SECRET` (HMAC-SHA1, base64, per [Twilio webhook security](https://www.twilio.com/docs/usage/webhooks/webhooks-security)).

### WebSocket route

- `WS /twilio/voice/stream` — accepts Twilio Media Streams handshake, opens a paired WS to OpenAI Realtime, and proxies audio frames in both directions (binary mulaw chunks base64-encoded inside Twilio JSON envelopes).

### Realtime session shape

- **Instructions:** persona + owner profile + memory snapshot + call-specific goal (for outbound) or default greeting prompt (for inbound).
- **Tools exposed to Realtime:**
  - `consult_claude(question, return_format)` — synchronous call into existing engine; returns answer the realtime model can speak.
  - `send_telegram(text)` — fires off a Telegram DM (e.g. summary of call so far).
  - `save_memory(entry)` — durable note from the call.
  - `create_job(name, schedule, prompt)` — wraps existing `addJob`.
  - `update_beads_task(id, status, note)` — wraps Beads CLI if present.
  - `end_call(reason)` — hangs up cleanly.
- **Voice:** configurable via `PHONE_VOICE` env (default `marin` — pleasant, low-latency).
- **Turn-detection:** server-side VAD with ~300ms silence threshold.

### `place_call` MCP tool (`src/mcp/server.ts` + `src/mcp/tools.ts`)

Signature:

```ts
place_call({
  number: string,          // E.164, e.g. "+918888..." or "+13025..."
  goal: string,            // What Nia should accomplish — becomes realtime instructions
  context?: string,        // Extra info to seed (calendar dump, prior call notes, etc.)
  max_minutes?: number,    // Hard cap; default 10
  voice?: string,          // Override default voice
})
```

Returns: `{ callSid, status, startedAt }`. The call runs asynchronously; final transcript is persisted to `messages` on completion.

### Persistence

- One `sessions` row per call (`room = phone-<callSid>`, `channel = 'phone'`).
- One `messages` row per realtime "response" turn (user-said and assistant-said), preserving order.
- Call-level metadata stored on the session: caller number, direction (`inbound`/`outbound`), duration, hang-up reason.

## Allowlist

`PRIMARY_PHONE_USER` is the owner. Additional allowed callers via `PHONE_ALLOWLIST` (comma-separated E.164 numbers). On inbound:

1. Look up caller ID against `PRIMARY_PHONE_USER` + `PHONE_ALLOWLIST`.
2. Owner: full-context greeting, all tools enabled.
3. Allowlisted: personalized greeting (configurable per number in `~/.niahere/phone/contacts.yaml`), reduced tool surface (no `create_job`, no `update_beads_task`).
4. Unknown: voicemail prompt + Telegram notification, then hangup. (Screener mode in phase 2.)

## Security

- `X-Twilio-Signature` validated on every inbound HTTP request.
- WebSocket handshake checks that the stream key matches a recently-initiated call (defends against random WS connections hitting the public tunnel).
- All env-loaded secrets surfaced through `getConfig().channels.phone` so no module reads `process.env` directly.
- Twilio outbound: Basic auth header (`TWILIO_SID:TWILIO_SECRET`) on all REST calls.

## Error handling

- Twilio webhook validation failure: 403, log, drop. No retry loop, Twilio won't retry on 4xx.
- OpenAI Realtime disconnect mid-call: attempt one reconnect within 2s, then fall back to a polite TwiML `<Say>` message and hangup. Persist whatever transcript we have.
- `place_call` Twilio API failure: surface the Twilio error code in the tool result; Claude decides whether to retry.
- Hard cap on call duration via `max_minutes` enforced server-side; we hang up if exceeded.

## Phasing

- **1A** — channel scaffold, config plumbing, types. (this PR)
- **1B** — Twilio webhook HTTP server + outbound dialing with static TwiML (no realtime yet). Confirms creds, signature validation, end-to-end dial.
- **1C** — Media Streams WS bridge to OpenAI Realtime. Real voice loop.
- **1D** — `place_call` MCP tool wired through. Schedulable from jobs.
- **1E** — Persistence of transcripts + sample disabled `morning-standup` job. Smoke-testable.

Phase 2 (not in this work):

- Receptionist mode for unknowns.
- Per-contact behavior profiles loaded from yaml.
- Call recording + Whisper transcription archive (separate from realtime's running transcript).

## Test plan

- Unit: signature validator, allowlist matcher, TwiML response shape, env loading.
- Integration: mocked Twilio webhook hitting the real handler returns expected TwiML.
- Smoke (manual, post-1B): outbound call from `place_call` plays a static greeting.
- Smoke (manual, post-1C): inbound call from owner number reaches realtime model, model can invoke `consult_claude` and `send_telegram`.

## Env vars (added)

```
TWILIO_SID            # already set
TWILIO_SECRET         # already set
PRIMARY_PHONE_USER    # already set — owner's number (E.164)
PHONE_FROM_NUMBER     # NEW — Twilio number Nia dials from (+13025480697)
PHONE_PORT            # NEW — local HTTP port (default 7079)
PUBLIC_BASE_URL       # NEW — cloudflared public hostname, no trailing slash
OPENAI_API_KEY        # NEW — for Realtime API
PHONE_ALLOWLIST       # NEW (optional) — comma-separated extra E.164 numbers
PHONE_VOICE           # NEW (optional) — realtime voice name, default "marin"
```
