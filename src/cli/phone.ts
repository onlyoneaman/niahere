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
      "Phone channel not configured. Need TWILIO_SID, TWILIO_SECRET, PHONE_FROM_NUMBER in .env (plus OPENAI_API_KEY and PUBLIC_BASE_URL for the realtime voice loop).",
    );
  }

  await channel!.start();
  const cfg = getConfig().channels.phone;
  console.log(`${ICON_PASS} phone server up on :${cfg.port}`);
  if (!cfg.public_base_url) {
    console.log(`${ICON_WARN} PUBLIC_BASE_URL not set — Twilio cannot reach this server.`);
    console.log(`         Start cloudflared (or your tunnel) and set PUBLIC_BASE_URL in .env first.`);
    await channel!.stop();
    process.exit(1);
  }
  if (!cfg.openai_api_key) {
    console.log(`${ICON_WARN} OPENAI_API_KEY not set — realtime voice loop will fall back to TwiML <Say>.`);
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
  const cfg = getConfig().channels.phone;
  const lines = [
    `from:           ${cfg.from_number ?? "(not set)"}`,
    `owner:          ${cfg.owner_number ?? "(not set)"}`,
    `allowlist:      ${cfg.allowlist.length ? cfg.allowlist.join(", ") : "(empty)"}`,
    `port:           ${cfg.port}`,
    `public_base_url:${cfg.public_base_url ?? "(not set)"}`,
    `realtime_model: ${cfg.realtime_model}`,
    `voice:          ${cfg.voice}`,
    `twilio creds:   ${cfg.twilio_sid && cfg.twilio_secret ? "configured" : "MISSING"}`,
    `openai key:     ${cfg.openai_api_key ? "configured" : "MISSING"}`,
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
    "Required env:",
    "  TWILIO_SID, TWILIO_SECRET, PHONE_FROM_NUMBER",
    "  OPENAI_API_KEY (for realtime voice loop)",
    "  PUBLIC_BASE_URL (cloudflared/ngrok tunnel pointing at PHONE_PORT)",
  ].join("\n");
}
