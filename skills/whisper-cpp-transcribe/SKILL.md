---
name: whisper-cpp-transcribe
description: Transcribe or subtitle audio/video files using whisper.cpp (whisper-cpp), with a default medium model path and ffmpeg-based extraction.
---

## Overview
Use this skill when the user wants Whisper.cpp to convert speech in local media files to text outputs (TXT, SRT, VTT, JSON, etc.).

## Quick Start
1. Confirm `whisper-cpp` is installed and discoverable (`whisper-cli -h`).
   - If missing on macOS with Homebrew available, install it with `brew install whisper-cpp`.
   - Do not reinstall when present. Use `brew upgrade whisper-cpp` only when the user explicitly asks to update the installed package.
2. Resolve input type:
   - If input is video or unsupported audio format, extract WAV first with `ffmpeg`.
   - If input is WAV/MP3/OGG/FLAC, pass it directly.
3. Ensure model path exists: `$HOME/.cache/whisper-cpp/models/ggml-medium.bin`.
4. Run `whisper-cli` with `-m <model>` and `-f <input>` and requested output flags (`-otxt`, `-osrt`, etc.).
5. Clean up temporary extracted files.

## Install / Update
- Check first:
  - `command -v whisper-cli`
  - `whisper-cli -h`
- If `whisper-cli` is missing and Homebrew is available:
  - `brew install whisper-cpp`
- If `whisper-cli` is present:
  - do not install again
- If the user explicitly asks to update the installed package:
  - `brew upgrade whisper-cpp`

## Default Model
- Primary model: `ggml-medium.bin`
- Default location expected by this skill:
  - `"$HOME/.cache/whisper-cpp/models/ggml-medium.bin"`
- Expected file:
  - size: `1533763059` bytes
  - SHA-256: `6c14d5adee5f86394037b4e4e8b59f1673b6cee10e3cf0b11bbdbee79c156208`
- If the file is missing or does not match the expected size/hash:
  - Download on stable Wi-Fi only, using a resumable temporary file and atomic rename:
    - `mkdir -p "$HOME/.cache/whisper-cpp/models"`
    - `curl -L -C - --fail --show-error --retry 5 --retry-delay 2 -o "$HOME/.cache/whisper-cpp/models/ggml-medium.bin.tmp" https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.bin`
    - `test "$(wc -c < "$HOME/.cache/whisper-cpp/models/ggml-medium.bin.tmp" | tr -d ' ')" = "1533763059"`
    - `test "$(shasum -a 256 "$HOME/.cache/whisper-cpp/models/ggml-medium.bin.tmp" | cut -d' ' -f1)" = "6c14d5adee5f86394037b4e4e8b59f1673b6cee10e3cf0b11bbdbee79c156208"`
    - `mv "$HOME/.cache/whisper-cpp/models/ggml-medium.bin.tmp" "$HOME/.cache/whisper-cpp/models/ggml-medium.bin"`

## Workflow
- Install check:
  - `command -v whisper-cli || brew install whisper-cpp`
  - `whisper-cli -h`
  - `ffmpeg -version` (required only when input video or unsupported audio format is used)
- Extract audio when needed:
  - `ffmpeg -y -i "<input>" -ac 1 -ar 16000 -c:a pcm_s16le "<tmp>.wav"`
- Transcribe:
  - `whisper-cli -m "$HOME/.cache/whisper-cpp/models/ggml-medium.bin" -f "<audio>" -otxt -osrt`
- Optional translation:
  - append `-tr`
- Optional language override:
  - `-l en` (or another language)
- Preserve output path:
  - `-of "<output-path-without-extension>"`

## Decision Points
- If download bandwidth is constrained, ask before downloading the medium model.
- If input is a large file and hardware is limited:
  - suggest `small`/`base` model first, then run `medium` if needed.
- If only subtitle output is requested:
  - use `-osrt` or `-ovtt` instead of `-otxt`.
- If audio is noisy and transcripts are poor:
  - advise VAD usage:
    - `--vad -vm ggml-silero-v6.2.0.bin` after obtaining the VAD model.

## Validation
- Confirm model integrity:
  - `wc -c "$HOME/.cache/whisper-cpp/models/ggml-medium.bin"`
  - `shasum -a 256 "$HOME/.cache/whisper-cpp/models/ggml-medium.bin"`
- Run one small sample and inspect:
  - generated `<input>.txt`
  - generated `<input>.srt` (if requested)
- Confirm transcript timestamps/accuracy in a short spot-check before processing large files.
