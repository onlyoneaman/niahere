---
name: image-generation
description: Generate images using OpenAI (default) or Gemini. Use when asked to generate, create, or make images. Supports text-to-image and image editing with reference images.
---

# Image Generation

General-purpose image generation skill supporting **OpenAI** (default) and **Gemini**.

## Script

`scripts/generate_image.py` — zero external dependencies (stdlib only).

## Setup

API keys in `~/.niahere/config.yaml`:

```yaml
openai_api_key: sk-...
gemini_api_key: AIza...
```

Or set via CLI or environment variables:

```bash
nia config set openai_api_key sk-...
nia config set gemini_api_key AIza...
```

Keys are resolved in order: `--api-key` flag > env var (`$OPENAI_API_KEY` / `$GEMINI_API_KEY`) > `config.yaml`.

## Providers & Models

| Provider             | Default Model                                    | Alternatives                                                                  |
| -------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------- |
| **OpenAI** (default) | `gpt-image-2`                                    | `gpt-image-1.5`, `gpt-image-1-mini`                                           |
| **Gemini**           | `gemini-3.1-flash-image-preview` (Nano Banana 2) | `gemini-3-pro-image-preview` (Nano Banana Pro), `gemini-2.5-flash-image` (GA) |

`gpt-image-2` (Apr 2026) is the current OpenAI flagship — native reasoning, up to 16 reference images, native 2K. `dall-e-2`/`dall-e-3` were shut off on the API on May 12, 2026.

## Per-image pricing (May 2026)

| Model                            | Price                                                                                |
| -------------------------------- | ------------------------------------------------------------------------------------ |
| `gpt-image-2`                    | ~$0.006 (low) → $0.053 (medium 1024) → $0.35 (high 4K). Token-based; Batch API −50%. |
| `gpt-image-1.5`                  | ~20% cheaper than gpt-image-1 across tiers                                           |
| `gpt-image-1`                    | low $0.011, medium $0.042, high $0.167 (1024²)                                       |
| `gemini-3-pro-image-preview`     | $0.134 (1K/2K), $0.24 (4K)                                                           |
| `gemini-3.1-flash-image-preview` | $0.045 (512), $0.067 (1K), $0.101 (2K), $0.151 (4K)                                  |
| `gemini-2.5-flash-image`         | $0.039 standard, $0.0195 batch                                                       |

## Quick Reference

```bash
SCRIPT="$(dirname "$0")/scripts/generate_image.py"   # or the absolute path under your skills dir

# Basic generation (OpenAI gpt-image-2, default)
python3 $SCRIPT --prompt "A sunset over mountains"

# High quality
python3 $SCRIPT --prompt "Oil painting of a forest" --quality high

# 2K output (OpenAI gpt-image-2; Gemini 2K via --resolution)
python3 $SCRIPT --prompt "Detailed cityscape" --resolution 2K

# Aspect ratio
python3 $SCRIPT --prompt "Portrait photo" --aspect-ratio 3:4

# With reference image (OpenAI edit mode)
python3 $SCRIPT --prompt "Add a rainbow to this scene" --reference photo.png

# Gemini provider
python3 $SCRIPT --provider gemini --prompt "Watercolor sunset" --aspect-ratio 16:9

# Gemini 4K (use Pro — 3.1 Flash currently ignores 2K/4K and returns ~1K)
python3 $SCRIPT --provider gemini --model gemini-3-pro-image-preview \
  --prompt "Cinematic landscape" --resolution 4K --aspect-ratio 16:9

# Gemini with reference
python3 $SCRIPT --provider gemini --reference face.png \
  --prompt "Same person sitting in a cafe, natural lighting" --aspect-ratio 9:16

# Custom output location
python3 $SCRIPT --prompt "A cat" --output /path/to/output/
```

## Aspect Ratios

| Use Case        | Ratio           | Notes         |
| --------------- | --------------- | ------------- |
| Square / social | `1:1`           | Default       |
| Portrait        | `3:4` or `2:3`  | Vertical      |
| Landscape       | `4:3` or `16:9` | Wide          |
| Phone / story   | `9:16`          | Vertical tall |
| Ultrawide       | `21:9`          | Cinematic     |

OpenAI maps ratios to closest supported size. At `--resolution 1K` (default): `1024x1024`, `1024x1536`, `1536x1024`. At `--resolution 2K`: `2048x2048`, `1536x2048`, `2048x1536` (gpt-image-2 only; dims must be multiples of 16, max ~2048).

## Resolution (`--resolution`)

- OpenAI: `1K` (default) or `2K` (gpt-image-2 only).
- Gemini: `1K` (default), `2K`, or `4K`. **Caveat:** `gemini-3.1-flash-image-preview` currently ignores 2K/4K and returns ~1K — use `gemini-3-pro-image-preview` for true 2K/4K.

## OpenAI Quality (`--quality`)

Applies to all `gpt-image-*` models.

- `auto` (default) — let the model decide
- `high` — best quality, slower
- `medium` — balanced
- `low` — fastest, cheapest

## Structured Prompt Tips

For photorealistic results, use structured JSON prompts covering separate concerns:

```json
{
  "subject": "description of the main subject, pose, expression",
  "clothing": "specific garments, colors, fabrics",
  "camera": "lens mm, aperture, shot type, angle",
  "lighting": "source, direction, quality, shadows",
  "environment": "setting, background elements, atmosphere",
  "color_grading": "palette, contrast, mood",
  "technical": "style keywords — photorealistic, 8k, hyper-detailed"
}
```

Key principles:

1. **Separate concerns** — one aspect per block
2. **Specify camera** — lens mm and aperture drive realism
3. **Light direction** — "soft light from upper right" > "good lighting"
4. **Material callouts** — "ribbed knit", "satin", "denim" > "nice clothes"
5. **Avoid over-constraining** — 2-3 adjectives per block max

## Provider Selection Guide

| Need                                 | Use                                                          |
| ------------------------------------ | ------------------------------------------------------------ |
| General image gen, highest quality   | OpenAI `gpt-image-2`                                         |
| Budget-friendly                      | OpenAI `gpt-image-1-mini` or Gemini `gemini-2.5-flash-image` |
| Reference-based identity (same face) | Gemini (better at preserving identity from reference)        |
| Image editing / inpainting           | OpenAI edit mode (`--reference`)                             |
| 4K output                            | Gemini `gemini-3-pro-image-preview` (`--resolution 4K`)      |
| Free tier / no OpenAI key            | Gemini                                                       |

## Combining with Bella

For Bella-specific image generation (identity-locked, reference-based), use the bella skill's `bella-image-generation.md` workflow instead. This skill is for general-purpose image generation without persona constraints.
