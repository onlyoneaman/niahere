---
name: whisper-cpp-transcribe
description: Transcribe or subtitle audio/video files using whisper.cpp (whisper-cpp), with a default large-v3 model path and ffmpeg-based extraction.
---

## Overview
Use this skill when the user wants Whisper.cpp to convert speech in local media files to text outputs (TXT, SRT, VTT, JSON, etc.).

## Quick Start
1. Confirm `whisper-cpp` is installed and discoverable (`whisper-cli -h`).
2. Resolve input type:
   - If input is video or unsupported audio format, extract WAV first with `ffmpeg`.
   - If input is WAV/MP3/OGG/FLAC, pass it directly.
3. Ensure model path exists: `$HOME/.cache/whisper-cpp/models/ggml-large-v3.bin`.
4. Run `whisper-cli` with `-m <model>` and `-f <input>` and requested output flags (`-otxt`, `-osrt`, etc.).
5. Clean up temporary extracted files.

## Default Model
- Primary model: `ggml-large-v3.bin`
- Default location expected by this skill:
  - `"$HOME/.cache/whisper-cpp/models/ggml-large-v3.bin"`
- If the file is missing:
  - Download on stable Wi-Fi only:
    - `curl -L --fail --show-error -o "$HOME/.cache/whisper-cpp/models/ggml-large-v3.bin" https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3.bin`

## Workflow
- Install check:
  - `whisper-cli -h`
  - `ffmpeg -version` (required only when input video or unsupported audio format is used)
- Extract audio when needed:
  - `ffmpeg -y -i "<input>" -ac 1 -ar 16000 -c:a pcm_s16le "<tmp>.wav"`
- Transcribe:
  - `whisper-cli -m "$HOME/.cache/whisper-cpp/models/ggml-large-v3.bin" -f "<audio>" -otxt -osrt`
- Optional translation:
  - append `-tr`
- Optional language override:
  - `-l en` (or another language)
- Preserve output path:
  - `-of "<output-path-without-extension>"`

## Decision Points
- If download bandwidth is constrained, ask before downloading the large-v3 model.
- If input is a large file and hardware is limited:
  - suggest `small`/`base` model first, then run `large-v3` if needed.
- If only subtitle output is requested:
  - use `-osrt` or `-ovtt` instead of `-otxt`.
- If audio is noisy and transcripts are poor:
  - advise VAD usage:
    - `--vad -vm ggml-silero-v6.2.0.bin` after obtaining the VAD model.

## Validation
- Run one small sample and inspect:
  - generated `<input>.txt`
  - generated `<input>.srt` (if requested)
- Confirm transcript timestamps/accuracy in a short spot-check before processing large files.
