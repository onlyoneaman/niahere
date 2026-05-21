---
name: nia-phone
description: >
  Use when setting up, deploying, or debugging Nia's Twilio-based channels:
  voice (phone), SMS, and WhatsApp. All three share one Twilio number,
  one webhook server, and one set of credentials under channels.twilio.
  Covers config schema, cloudflared named-tunnel setup, Twilio Console
  webhook wiring, `nia phone` CLI, `place_call` / `send_message` MCP
  tools, the WhatsApp Sandbox 24h customer-service window, and the
  shared TwilioWebhookServer's dedup + rate-limit middleware. Trigger
  on mentions of "phone", "call", "voice", "sms", "whatsapp", "twilio",
  "realtime", "media stream", "cloudflared", or when deploying Nia to
  a new machine and a Twilio surface needs to come up.
---

## Overview

Three Twilio-based channels share one phone number, one webhook server,
and one set of credentials:

- **Phone** (`src/channels/phone/`) — voice via Twilio Programmable
  Voice + OpenAI Realtime. Inbound (caller dials) and outbound
  (`place_call` MCP tool / `nia phone call` CLI).
- **SMS** (`src/channels/sms.ts`) — Twilio Messaging on the same number.
  Inbound webhook → chat engine → REST reply. The reachability
  fallback when data is unavailable but cellular works.
- **WhatsApp** (`src/channels/whatsapp.ts`) — Twilio WhatsApp Sandbox
  by default; production WABA when policy permits. Enforces Meta's
  24-hour customer-service window — outside it, free-form replies are
  dropped (Twilio rejects without an approved template).

All three register routes on the shared `TwilioWebhookServer`
(`src/channels/twilio/server.ts`), which centralizes:

- `X-Twilio-Signature` HMAC-SHA1 validation
- `MessageSid` / `CallSid` deduplication (Twilio retries on 5xx/timeouts)
- Per-remote-number rate limiting (30/min default; owner exempt)
- `/healthz` and `/twilio/health` endpoints

Transcripts persist to the `messages` table with `channel='phone'`,
`'sms'`, or `'whatsapp'` and `room=<channel>-<callSid|E164>`.

## Configuration

Twilio creds + identity are shared across all three channels under
`channels.twilio`. Each channel has its own enable flag and channel-specific
config under `channels.{phone,sms,whatsapp}`.

```yaml
# ~/.niahere/config.yaml
channels:
  twilio:
    sid: AC... # Account SID (or API Key SID SK…; Twilio resolves both)
    secret: ... # Auth Token if sid is AC…, API Key Secret if SK…
    auth_token: ... # Required when sid is SK… (signs webhooks). Omit if secret is the Auth Token.
    owner_number: "+91..." # Highest-trust caller/messenger
    allowlist: ["+12025550100"] # Extra allowed senders/callers (E.164)
    public_base_url: https://nia.example.com # No trailing slash
    port: 7079 # Local port the shared webhook server binds to

  phone:
    enabled: true
    from_number: "+13025480697" # Twilio number for voice
    openai_api_key: sk-proj-... # For the Realtime voice loop
    realtime_model: gpt-realtime
    voice: marin # marin | cedar | shimmer | coral | alloy | ash | …

  sms:
    enabled: true
    from_number: "+13025480697" # Defaults to phone.from_number if omitted

  whatsapp:
    enabled: true
    from_number: "+14155238886" # Twilio Sandbox shared number; replace once WABA is approved
```

Env overrides (use these if you'd rather keep secrets in `.env`):

```
TWILIO_SID, TWILIO_SECRET, TWILIO_AUTH_TOKEN
PRIMARY_PHONE_USER (owner), PHONE_ALLOWLIST (comma-separated)
PUBLIC_BASE_URL, PHONE_PORT
PHONE_FROM_NUMBER, OPENAI_API_KEY, PHONE_VOICE, PHONE_REALTIME_MODEL
SMS_FROM_NUMBER, WHATSAPP_FROM_NUMBER
```

**Backward compat:** the previous `channels.phone.{twilio_sid, twilio_secret,
twilio_auth_token, owner_number, allowlist, public_base_url, port}` shape
is still read as a fallback for one release cycle. Migrate when convenient.

`nia phone status` prints which fields are set across all three channels.

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

## Twilio Console webhook wiring

Outbound paths (voice via `placeCall`, SMS/WhatsApp via Messages REST)
control their own URLs and don't need Console config. Inbound paths do.

**Voice** (per phone number):

1. Twilio Console → Phone Numbers → Active Numbers → click your number.
2. Voice Configuration → "A call comes in" → Webhook (POST).
3. URL: `https://<PUBLIC_BASE_URL>/twilio/voice/incoming`
4. Status callback: `https://<PUBLIC_BASE_URL>/twilio/voice/status` (POST)

**SMS** (per phone number):

1. Same number → Messaging Configuration → "A message comes in" → Webhook (POST).
2. URL: `https://<PUBLIC_BASE_URL>/twilio/sms/incoming`
3. Status callback: `https://<PUBLIC_BASE_URL>/twilio/sms/status` (POST)

You can also set both via REST in one shot:

```bash
curl -X POST "https://api.twilio.com/2010-04-01/Accounts/<AC...>/IncomingPhoneNumbers/<PN...>.json" \
  -u "<SID>:<SECRET>" \
  --data-urlencode "VoiceUrl=https://nia.example.com/twilio/voice/incoming" \
  --data-urlencode "SmsUrl=https://nia.example.com/twilio/sms/incoming" \
  --data-urlencode "StatusCallback=https://nia.example.com/twilio/voice/status"
```

**WhatsApp Sandbox**:

1. Console → Messaging → Try it out → Send a WhatsApp message.
2. Note the printed `join <two-words>` token.
3. From your phone's WhatsApp, send `join <two-words>` to `+1 415 523 8886`. You're opted in.
4. Sandbox settings → "When a message comes in" → Webhook (POST).
5. URL: `https://<PUBLIC_BASE_URL>/twilio/whatsapp/incoming`
6. Status callback: `https://<PUBLIC_BASE_URL>/twilio/whatsapp/status`

Sandbox opt-in expires after 72h of inactivity — rejoin with the same code.

If the Twilio account is on trial, every destination number (SMS,
WhatsApp, outbound voice) must be in the Verified Caller IDs list.

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

## Architecture

`src/channels/twilio/server.ts` owns the Bun HTTP+WS server on
`channels.twilio.port` (default 7079). All three Twilio channels register
their routes on it during `start()`; the server handles signature
validation, dedup, and rate-limit middleware before dispatching to the
channel's handler.

- `src/channels/twilio/signature.ts` — HMAC-SHA1 X-Twilio-Signature check.
- `src/channels/twilio/dedup.ts` — TTL set for `MessageSid`/`CallSid`.
- `src/channels/twilio/rate-limit.ts` — sliding-window per-key limiter.
- `src/channels/twilio/rest.ts` — `placeCall`, `sendMessage`,
  `updateIncomingPhoneNumber`, etc. (Twilio REST helpers, no SDK).
- `src/channels/phone/` — voice channel: `twiml.ts` builds the
  `<Connect><Stream>` TwiML, `relay.ts` bridges Twilio Media Streams
  (mulaw 8 kHz) to OpenAI Realtime (same `g711_ulaw` format — no
  resampling), `tools.ts` exposes `consult_claude` / `send_telegram` /
  `save_memory` / `end_call` to the voice agent, `consult.ts` is the
  Claude escape hatch, `instructions.ts` builds the system prompts.
- `src/channels/sms.ts` — SMS channel. Inbound webhook → chat engine →
  REST reply. One engine per remote E.164 (`sms-<E164>` room).
- `src/channels/whatsapp.ts` — WhatsApp channel. Same shape, plus
  `whatsapp:` prefix on Twilio addresses and `lastInboundAt` tracking
  for the 24h customer-service window (outside it, replies are dropped
  with a log entry — Twilio would reject them anyway).

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
7. **WhatsApp 24-hour customer-service window is enforced.** Outside it,
   Twilio rejects free-form replies (template-only). The whatsapp channel
   tracks `lastInboundAt` per remote and fails closed with a log line
   instead of sending what Twilio will reject.
8. **WhatsApp Sandbox opt-in expires after 72h of inactivity.** Aman gets
   silently disconnected mid-trip; rejoin by texting the same
   `join <two-words>` code to +1 415 523 8886.
9. **US-Twilio-long-code → India SMS outbound deliverability is unreliable.**
   Meta's TRAI scrubbing rules + US-side A2P 10DLC throttling drop a
   chunk of outbound. Inbound (India → US Twilio) is more reliable.
   Treat outbound as best-effort; smoke-test empirically.
10. **Shared WhatsApp Sandbox number means strangers can opt in.** The
    allowlist + per-remote rate limit are the only defenses; both are
    enforced by the channel/server layers — don't remove them.
