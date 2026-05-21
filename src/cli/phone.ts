/**
 * `nia phone <subcommand>` — small CLI surface for the phone channel.
 *
 * Subcommands:
 *   call <number> <goal...>    — place an outbound call, wait, print transcript
 *   status                     — show phone channel config + state
 *
 * The call subcommand boots a standalone phone channel server, places the
 * call, waits for it to complete, then exits. It does NOT start the full
 * daemon — useful for smoke-testing voice end-to-end without the daemon.
 */
import { createPhoneChannel } from "../channels/phone";
import { getConfig } from "../utils/config";
import { fail, ICON_PASS, ICON_WARN } from "../utils/cli";

export async function phoneCommand(): Promise<void> {
  const sub = process.argv[3];

  switch (sub) {
    case "call":
      await phoneCallCommand();
      return;
    case "status":
      phoneStatusCommand();
      return;
    case undefined:
    case "help":
    case "--help":
    case "-h":
      printHelp();
      return;
    default:
      fail(`Unknown phone subcommand: ${sub}\n\n${helpText()}`);
  }
}

async function phoneCallCommand(): Promise<void> {
  const number = process.argv[4];
  const goalParts = process.argv.slice(5);
  if (!number || goalParts.length === 0) {
    fail('Usage: nia phone call <e164-number> "<goal sentence...>"');
  }
  const goal = goalParts.join(" ");

  const channel = createPhoneChannel();
  if (!channel) {
    fail(
      "Phone channel not configured. Set channels.twilio.{sid,secret} and channels.phone.from_number in ~/.niahere/config.yaml (also channels.phone.openai_api_key and channels.twilio.public_base_url for the realtime voice loop). Env vars TWILIO_SID / TWILIO_SECRET / PHONE_FROM_NUMBER / OPENAI_API_KEY / PUBLIC_BASE_URL override if you prefer .env.",
    );
  }

  await channel!.start();
  const { twilio, phone } = getConfig().channels;
  console.log(`${ICON_PASS} phone server up on :${twilio.port}`);
  if (!twilio.public_base_url) {
    console.log(`${ICON_WARN} public_base_url not set — Twilio cannot reach this server.`);
    console.log(`         Start cloudflared (or your tunnel) and set channels.twilio.public_base_url in config.yaml.`);
    await channel!.stop();
    process.exit(1);
  }
  if (!phone.openai_api_key) {
    console.log(`${ICON_WARN} openai_api_key not set — realtime voice loop will fall back to TwiML <Say>.`);
  }

  console.log(`  dialing ${number} ...`);
  console.log(`  goal: ${goal}`);

  const result = await channel!.placeCall({
    number,
    goal,
    maxMinutes: 5,
  });
  console.log(`${ICON_PASS} call placed: ${result.callSid} (${result.status})`);

  console.log(`  waiting for call to complete...`);
  const completion = await channel!.awaitCallCompletion(result.callSid);
  if (!completion) {
    console.log(`${ICON_WARN} no completion handle for ${result.callSid}`);
    await channel!.stop();
    return;
  }

  console.log("");
  console.log(`--- transcript (${completion.transcript.length} turns, ended: ${completion.endedReason}) ---`);
  for (const turn of completion.transcript) {
    console.log(`  ${turn.role}: ${turn.text}`);
  }
  if (completion.error) console.log(`  error: ${completion.error}`);

  await channel!.stop();
}

function phoneStatusCommand(): void {
  const { twilio, phone, sms, whatsapp } = getConfig().channels;
  const lines = [
    `phone enabled:    ${phone.enabled}`,
    `phone from:       ${phone.from_number ?? "(not set)"}`,
    `sms enabled:      ${sms.enabled}`,
    `sms from:         ${sms.from_number ?? `(defaults to phone: ${phone.from_number ?? "unset"})`}`,
    `whatsapp enabled: ${whatsapp.enabled}`,
    `whatsapp from:    ${whatsapp.from_number ?? "(not set)"}`,
    `owner:            ${twilio.owner_number ?? "(not set)"}`,
    `allowlist:        ${twilio.allowlist.length ? twilio.allowlist.join(", ") : "(empty)"}`,
    `port:             ${twilio.port}`,
    `public_base_url:  ${twilio.public_base_url ?? "(not set)"}`,
    `realtime_model:   ${phone.realtime_model}`,
    `voice:            ${phone.voice}`,
    `twilio creds:     ${twilio.sid && twilio.secret ? "configured" : "MISSING"}`,
    `twilio auth_token:${twilio.auth_token ? "configured" : "(falling back to secret)"}`,
    `openai key:       ${phone.openai_api_key ? "configured" : "MISSING"}`,
  ];
  console.log(lines.join("\n"));
}

function printHelp(): void {
  console.log(helpText());
}

function helpText(): string {
  return [
    "Usage: nia phone <subcommand>",
    "",
    "Subcommands:",
    '  call <e164-number> "<goal>"   Place an outbound call. Boots a standalone',
    "                                phone server, dials, waits, prints transcript.",
    "  status                        Show phone channel configuration.",
    "",
    "Config lives in ~/.niahere/config.yaml:",
    "  channels.twilio.{sid, secret}                       (required)",
    "  channels.phone.from_number                          (required)",
    "  channels.phone.openai_api_key, channels.twilio.public_base_url",
    "                                                      (required for realtime voice loop)",
    "  channels.twilio.auth_token                          (required if sid is an API Key SID)",
    "  channels.twilio.{owner_number, allowlist, port}     (optional)",
    "  channels.phone.{voice, realtime_model}              (optional)",
    "",
    "Each field can be overridden by the matching env var (TWILIO_SID, OPENAI_API_KEY, etc.)",
    "if you prefer .env. See the nia-phone skill for full deploy walkthrough.",
  ].join("\n");
}
