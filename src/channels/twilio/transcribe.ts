/**
 * Transcribe a short audio clip via OpenAI's gpt-4o-mini-transcribe.
 *
 * Used by the WhatsApp channel for voice notes. We accept the raw bytes
 * + MIME (Twilio's WhatsApp voice notes are typically audio/ogg with
 * opus codec — the endpoint handles ogg natively).
 */
import { log } from "../../utils/log";

const ENDPOINT = "https://api.openai.com/v1/audio/transcriptions";
const MODEL = "gpt-4o-mini-transcribe";
const TIMEOUT_MS = 30_000;

const MIME_TO_FILENAME: Record<string, string> = {
  "audio/ogg": "audio.ogg",
  "audio/mpeg": "audio.mp3",
  "audio/mp4": "audio.m4a",
  "audio/wav": "audio.wav",
  "audio/webm": "audio.webm",
  "audio/flac": "audio.flac",
};

export interface TranscribeOpts {
  apiKey: string;
  data: Buffer;
  mime: string;
  language?: string;
}

export async function transcribeAudio(opts: TranscribeOpts): Promise<string> {
  const filename = MIME_TO_FILENAME[opts.mime] ?? "audio.ogg";
  const form = new FormData();
  form.set("file", new Blob([new Uint8Array(opts.data)], { type: opts.mime }), filename);
  form.set("model", MODEL);
  if (opts.language) form.set("language", opts.language);
  form.set("response_format", "json");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${opts.apiKey}` },
      body: form,
      signal: controller.signal,
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`OpenAI transcribe failed: ${resp.status} ${text}`);
    }
    const json = (await resp.json()) as { text?: string };
    const text = (json.text || "").trim();
    log.info({ chars: text.length, mime: opts.mime }, "twilio: voice note transcribed");
    return text;
  } finally {
    clearTimeout(timer);
  }
}
