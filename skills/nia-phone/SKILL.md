---
name: nia-phone
description: >
  Use when setting up, deploying, or debugging Nia's phone channel
  (Twilio + OpenAI Realtime voice calls). Covers env vars, cloudflared
  named-tunnel setup, Twilio number webhook configuration, the
  `nia phone` CLI subcommands, and the `place_call` MCP tool. Trigger
  on mentions of "phone", "call", "voice", "twilio", "realtime", "ngrok",
  "cloudflared", "media stream", or when the user is deploying Nia to a
  new machine and needs the phone surface to come up.
---

## Overview

The phone channel (`src/channels/phone/`) bridges Twilio Programmable
Voice to the OpenAI Realtime API. It exposes:

- **Inbound calls** — owner or allowlisted contacts dial the Twilio
  number; the call is bridged to the realtime model with full persona
  context. Unknown callers are politely declined.
- **Outbound calls** — `place_call` MCP tool (or `nia phone call` CLI)
  dials a number, seeds a per-call goal into the realtime session, and
  Nia speaks first. Used by scheduled jobs (morning standup, evening
  retro, escalation pings) and by chat ("call the dentist for me").

Transcripts persist to the `messages` table with `channel = 'phone'` and
`room = phone-<callSid>`.

## Configuration

Phone config lives in `~/.niahere/config.yaml` under `channels.phone` —
same place as `channels.telegram` and `channels.slack`. Every field is
overridable by the matching env var if you prefer `.env` for secrets.

```yaml
# ~/.niahere/config.yaml
channels:
  phone:
    twilio_sid: AC... # Account SID — or an API Key SID (SK…)
    twilio_secret: ... # Auth Token if SID is AC, API Key Secret if SID is SK
    twilio_auth_token:
      ... # Required when twilio_sid is an API Key (SK…); signs webhooks.
      # Omit if twilio_secret is already the Auth Token.
    from_number: "+1..." # Your Twilio number (E.164)
    owner_number: "+91..." # Owner's phone (E.164) — highest-trust caller
    public_base_url: https://nia.example.com # No trailing slash
    openai_api_key: sk-proj-... # For the Realtime voice loop

    # Optional
    port: 7079 # Local port the webhook server binds to
    allowlist: ["+12025550100"] # Extra allowed inbound callers (E.164)
    voice: marin # Realtime voice (marin | cedar | shimmer | coral | alloy | ash | …)
    realtime_model: gpt-realtime
```

Env overrides (use these if you'd rather keep secrets in `.env`):

```
TWILIO_SID, TWILIO_SECRET, TWILIO_AUTH_TOKEN
PHONE_FROM_NUMBER, PRIMARY_PHONE_USER
PUBLIC_BASE_URL, OPENAI_API_KEY
PHONE_PORT, PHONE_ALLOWLIST (comma-separated), PHONE_VOICE, PHONE_REALTIME_MODEL
```

`nia phone status` prints which fields are set / missing.

## Cloudflared named tunnel (production)

The ephemeral `trycloudflare.com` URL is fine for testing but dies on
restart. For a persistent deploy:

```bash
brew install cloudflared
cloudflared tunnel login                          # opens browser, writes cert.pem
cloudflared tunnel create nia-mac                 # creates the tunnel
cloudflared tunnel route dns nia-mac nia.example.com   # CNAME on a Cloudflare-managed domain
```

Keep nia's tunnel config in nia's home as a single flat file:
`~/.niahere/cloudflared-config.yaml`. The cloudflared-internal artifacts
(`cert.pem`, the per-tunnel credentials JSON written by `tunnel create`)
stay where cloudflared put them — those are cloudflared's territory, not
nia's.

```yaml
# ~/.niahere/cloudflared-config.yaml
tunnel: nia-mac
credentials-file: /Users/<you>/.cloudflared/<tunnel-id>.json

ingress:
  - hostname: nia.example.com
    service: http://localhost:7079
  - service: http_status:404
```

Install as a launchd service, pointing it at our config:

```bash
sudo cloudflared --config ~/.niahere/cloudflared-config.yaml service install
```

If the generated plist at `/Library/LaunchDaemons/com.cloudflare.cloudflared.plist`
doesn't include the `--config` arg in `ProgramArguments`, edit it in, then:

```bash
sudo launchctl bootout system/com.cloudflare.cloudflared
sudo launchctl bootstrap system /Library/LaunchDaemons/com.cloudflare.cloudflared.plist
```

Then set in `.env`: `PUBLIC_BASE_URL=https://nia.example.com`.

Verify with `curl https://nia.example.com/healthz` — should return `ok`
once the daemon is running.

## Twilio number webhook (inbound only)

Outbound calls do NOT need any Twilio Console config — `placeCall`
controls the TwiML URL itself.

Inbound calls need the Twilio number's Voice webhook pointed at your
public URL:

1. Twilio Console → Phone Numbers → Active Numbers → click your number.
2. Voice Configuration → "A call comes in" → Webhook.
3. URL: `https://<PUBLIC_BASE_URL>/twilio/voice/incoming` — Method: POST.
4. Status callback URL: `https://<PUBLIC_BASE_URL>/twilio/voice/status`
   — Method: POST.
5. Save.

If the Twilio account is on trial, every destination number for
outbound calls must be in the Verified Caller IDs list.

## CLI

```bash
nia phone status                                   # show config + missing fields
nia phone call <+E164> "<goal sentence>"           # one-shot outbound smoke test
```

The `call` subcommand boots a standalone phone server, places the call,
waits for it to complete, then exits — does NOT need the daemon running.
Useful for smoke-testing without spinning up the full daemon.

## MCP tool — `place_call`

```ts
place_call({
  number: string,        // E.164, e.g. "+13025551234"
  goal: string,          // What Nia should accomplish — seeded into session instructions
  context?: string,      // Extra background (calendar dump, prior notes…)
  max_minutes?: number,  // Hard cap (default 10, max 30)
  voice?: string,        // Override default voice per call
})
```

Returns immediately with `{ callSid, status }`. The call completes
asynchronously; transcript lands in the `messages` table.

## Scheduled-job pattern (morning standup)

```bash
nia job add morning-standup "0 8 * * *" \
  "Call me at +917667078414 and run my morning standup. \
   Ask what I want to ship today, what's blocking me, \
   and what to dig into while I sleep. Listen more than \
   you talk. End cleanly when we're wrapped."
```

Daily standup at 8 AM owner-local time. Same pattern for evening retro,
weekly review, urgent escalation, etc.

## Architecture (one-paragraph)

`src/channels/phone/index.ts` boots a Bun HTTP+WS server on `PHONE_PORT`.
Twilio reaches it via cloudflared. `twiml.ts` builds the `<Connect><Stream>`
TwiML. `twilio.ts` calls Twilio's REST API and validates webhook
signatures (HMAC-SHA1 with the account Auth Token). `relay.ts` bridges
Twilio's Media Streams (mulaw, JSON-enveloped) to OpenAI Realtime
(same g711_ulaw format — no resampling). `tools.ts` exposes
`consult_claude`, `send_telegram`, `save_memory`, and `end_call` to the
voice agent. `consult.ts` is the Claude escape hatch for reasoning-heavy
turns. `instructions.ts` builds the system prompts.

## Cost model

| Component                                    | US → India | US → US |
| -------------------------------------------- | ---------- | ------- |
| Twilio voice (per min)                       | $0.10–0.15 | $0.014  |
| OpenAI Realtime (per min, mixed in+out)      | $0.20–0.30 | same    |
| `consult_claude` (per invocation, when used) | $0.01–0.05 | same    |

A 5-minute call to India runs ~$1.50–2.25. Daily morning standup is
~$45–70/month. Levers to cut cost: buy an Indian Twilio number for
domestic rates, tighten `max_minutes` (most standups finish in 2–3 min),
prefer Telegram voice notes over live calls for long-form things.

## Debugging

- `nia phone status` — verify env.
- `curl https://<PUBLIC_BASE_URL>/healthz` — confirms the tunnel reaches
  the daemon.
- `LOG_LEVEL=debug bun run src/cli/index.ts phone call …` — dumps every
  OpenAI Realtime event type (incl. ones we don't handle) so you can
  see what the GA API is actually sending.
- `bun test tests/phone.test.ts` — unit tests for TwiML + signature.

## Common pitfalls (learned the hard way)

1. **Don't try to update a queued call's TwiML URL.** Twilio rejects
   redirect until `in-progress`. Bake the routing into the URL Twilio
   first fetches, or read `CallSid` from the webhook body.
2. **GA Realtime needs `output_modalities: ["audio"]` in `session.update`.**
   Without it, the model silently drops audio synthesis and only emits
   transcripts — you'll get "done" events with no "delta" events.
3. **Drop the `OpenAI-Beta: realtime=v1` header.** GA endpoint rejects it.
4. **API Key SIDs (SK…) work for REST auth but NOT for webhook signature
   validation.** Set `TWILIO_AUTH_TOKEN` separately to the account-level
   Auth Token when using an API Key.
5. **Send the opener immediately on session open, don't wait for first
   media frame.** Otherwise the user picks up to silence and speaks
   first, which defeats "Nia calling you".
6. **Mac Mini sleep kills the daemon.** `sudo pmset -a sleep 0` keeps
   the host awake (display can still sleep).
