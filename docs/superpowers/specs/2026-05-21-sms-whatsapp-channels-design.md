# SMS + WhatsApp Channels for Nia

**Date:** 2026-05-21
**Status:** Plan approved (after dual independent review by general-purpose subagent + Codex), implementation in progress.

## Goal

Add Twilio SMS (inbound/outbound on existing `+1 302 548 0697`) and Twilio WhatsApp Sandbox (inbound/outbound) as two new channels under `src/channels/`. Together with the existing phone, telegram, and slack channels, this rounds out Nia's reachability across:

- **Full internet** → Telegram / Slack / WhatsApp
- **Cellular only (no data)** → SMS
- **Voice on cellular** → Phone (Twilio + OpenAI Realtime)

Primary motivating use case: Aman's upcoming Ladakh trip, where SMS works in patchy cell zones that don't carry data.

## Non-goals

- **Production WhatsApp WABA** — Meta's Jan 2026 policy bans general-purpose AI chatbots on the platform. Sandbox first; revisit production only if WhatsApp proves daily-useful and we can position the use case as task-specific.
- **Indian DLT registration** — multi-week paperwork for marginal benefit at personal usage.
- **BlueBubbles / iMessage gateway** — adds no India satellite path, pure UX nicety over SMS.
- **Restructuring existing phone channel beyond what's needed** for the shared server extraction.

## Architecture

### Shared Twilio webhook server

The phone channel currently runs its own Bun HTTP+WS server on `PHONE_PORT` (default 7079), exposed via cloudflared at `https://nia.amankumar.ai`. Adding SMS + WhatsApp without consolidation would mean 3 ports, 3 tunnel routes, 3 webhook bases — operationally wrong for a single-user daemon.

**Decision:** extract a shared `TwilioWebhookServer` at `src/channels/twilio/server.ts`. Owns the Bun HTTP+WS bootstrap. Channels register routes via:

```ts
server.registerHttp(path, handler); // POST handlers for inbound webhooks
server.registerWs(path, handler); // WS upgrade for media streams
```

Server provides:

- `X-Twilio-Signature` HMAC-SHA1 middleware on every HTTP route (one implementation, tested once).
- `MessageSid` deduplication (Twilio retries on 5xx/timeout; same SMS can arrive multiple times). Per-SID LRU with ~10 minute window.
- Per-remote-number rate limit (30 messages/min default) — strangers spamming the shared WhatsApp Sandbox number must not run up OpenAI tokens.
- `/healthz` (existing) and `/twilio/health` (Twilio Console can ping) endpoints.

### Config schema refactor

Both reviewers flagged "credentials reaching across `channels.phone` into other channels" as a smell that will rot. Refactor now while small.

New shape:

```yaml
channels:
  twilio: # SHARED across all Twilio channels
    account_sid: ACxxxxxx # or null if using api_key
    auth_token: ... # account-level Auth Token (for webhook sig + REST if no API key)
    api_key_sid: SKxxxxxx # optional (if using API Key auth for REST)
    api_key_secret: ... # optional
    owner_number: "+91..." # highest-trust caller
    allowlist: []
    public_base_url: https://nia.amankumar.ai
    port: 7079
  phone: # voice-only fields
    enabled: true
    from_number: "+13025480697" # number that places/receives voice
    openai_api_key: ...
    realtime_model: gpt-realtime
    voice: marin
  sms: # new
    enabled: true
    from_number: "+13025480697" # defaults to phone.from_number if absent
  whatsapp: # new
    enabled: true
    from_number: "+14155238886" # Twilio Sandbox; replace once WABA is approved
```

**Backward compat (one release cycle):** if the new keys are absent, fall back to reading the old `channels.phone.{twilio_sid, twilio_secret, twilio_auth_token, owner_number, allowlist, public_base_url, port}`. This keeps the Mac Mini's existing `~/.niahere/config.yaml` working without manual migration.

Migration helper logged on boot: "Detected legacy channels.phone.twilio\__ — consider migrating to channels.twilio._ per docs."

### SMS channel — `src/channels/sms.ts`

- Implements `Channel`.
- `start()`: `server.registerHttp('/twilio/sms/incoming', this.handleInbound)` + `'/twilio/sms/status'`.
- Inbound: parse `application/x-www-form-urlencoded` body → `{From, To, Body, MessageSid}` → allowlist check → route to `ChatEngine` (`room = sms-<E164>`, one engine per remote number) → reply via Twilio Messages REST.
- Outbound `sendMessage(text, opts?)`: POST `/Accounts/{sid}/Messages.json` with `From=channels.sms.from_number`, `To=outboundNumber`.
- Persists to messages table with `channel='sms'`.

### WhatsApp channel — `src/channels/whatsapp.ts`

Same shape as SMS with three differences:

1. Twilio addresses use `whatsapp:` prefix on both `From` and `To`.
2. Track `lastInboundAt` per remote number. Outside the 24-hour customer-service window, free-form replies are silently rejected by Twilio (template-only). Fail closed: log "outside 24h window, dropped reply" and don't attempt the send.
3. Document the Sandbox `join <code>` rejoin flow prominently — Sandbox opt-in expires after 72 hours of inactivity.

### MCP tool surface

No new MCP tools. Existing `send_message` already takes a `channel` arg — extends naturally to `'sms'` and `'whatsapp'`.

### Dependencies between channels

- Phone, SMS, WhatsApp all depend on the shared `TwilioWebhookServer`.
- The server's lifecycle is managed by whichever channel boots first — they all call `getTwilioServer()` which lazy-starts. Last-stop calls `server.stop()`.
- If only SMS is enabled (no phone, no whatsapp), the server still starts. Each channel boots independently.

## Tests

- `tests/channels/twilio-server.test.ts`: signature validation, dedup, rate limit, route registry.
- `tests/channels/sms.test.ts`: inbound parsing, allowlist, outbound URL shape.
- `tests/channels/whatsapp.test.ts`: same + 24h-window enforcement.
- Existing `tests/phone.test.ts`: keep, may rename to `tests/channels/phone.test.ts` for consistency.

## Deployment

- Twilio Console (or via REST API since Bella has access):
  - SMS: set `SmsUrl` on `+1 302 548 0697` to `https://nia.amankumar.ai/twilio/sms/incoming` (POST).
  - WhatsApp Sandbox: in Console → Messaging → Try it out → WhatsApp → set inbound webhook to `https://nia.amankumar.ai/twilio/whatsapp/incoming` (POST). Aman opts in by sending `join <code>` to `+1 415 523 8886` from his WhatsApp.

## Implementation order

1. ✅ Spec doc (this file).
2. Extract `TwilioWebhookServer`.
3. Config refactor with backward compat.
4. Refactor phone channel to use shared server + new config.
5. WhatsApp channel (higher reliability than SMS per Codex's read of Twilio India docs).
6. SMS channel.
7. Tests.
8. Skill / README / AGENTS.md updates.
9. Wire Twilio webhooks via REST.
10. Smoke test end-to-end (Mac Mini + real Twilio).
11. Ask for release confirmation (memory rule: don't release without explicit ask).

## Risks + open empirical questions

- **US-Twilio-long-code → India SMS deliverability:** unclear. General-purpose subagent says 40–70% delivery with US-side A2P 10DLC throttling; Codex says Indian users can't reply at all to a US Twilio number. These contradict. Plan: ship and test empirically — if Aman texts `+1 302 548 0697` from his Indian SIM and Twilio's inbound log shows the message, we have ground truth on the inbound leg. Outbound leg can be measured by checking Twilio's delivery callbacks.
- **WhatsApp Sandbox shared-number opt-ins**: allowlist enforcement is the only thing standing between us and stranger spam. Enforce hard from day 1 + per-number rate limit.
- **Phone channel refactor regression**: the server extraction touches code that's currently working in production on the Mac Mini. Test thoroughly before deploying.
- **Config migration on Mac Mini**: backward-compat keeps existing yaml working, but the operator should still migrate to the new shape. Log a deprecation hint.

## Estimated effort

~2 days (general-purpose subagent's revised estimate). ~600–800 net new LOC including the refactor.
