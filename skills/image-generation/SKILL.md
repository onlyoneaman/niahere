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

| Provider | Default Model | Alternatives |
|----------|--------------|--------------|
| **OpenAI** (default) | `gpt-image-1.5` | `gpt-image-1`, `gpt-image-1-mini` |
| **Gemini** | `gemini-3.1-flash-image-preview` | `gemini-3-pro-image-preview`, `gemini-2.5-flash-image` |

Note: `dall-e-2` and `dall-e-3` are deprecated (EOL May 2026). Use `gpt-image-1.5` instead.

## Quick Reference

```bash
SCRIPT="/Users/aman/.shared/skills/image-generation/scripts/generate_image.py"

# Basic generation (OpenAI, default)
python3 $SCRIPT --prompt "A sunset over mountains"

# High quality
python3 $SCRIPT --prompt "Oil painting of a forest" --quality high

# With aspect ratio
python3 $SCRIPT --prompt "Portrait photo" --aspect-ratio 3:4

# With reference image (OpenAI edit mode)
python3 $SCRIPT --prompt "Add a rainbow to this scene" --reference photo.png

# Gemini provider
python3 $SCRIPT --provider gemini --prompt "Watercolor sunset" --aspect-ratio 16:9

# Gemini with reference
python3 $SCRIPT --provider gemini --reference face.png \
  --prompt "Same person sitting in a cafe, natural lighting" --aspect-ratio 9:16

# Custom output location
python3 $SCRIPT --prompt "A cat" --output /path/to/output/
```

## Aspect Ratios

| Use Case | Ratio | Notes |
|----------|-------|-------|
| Square / social | `1:1` | Default |
| Portrait | `3:4` or `2:3` | Vertical |
| Landscape | `4:3` or `16:9` | Wide |
| Phone / story | `9:16` | Vertical tall |
| Ultrawide | `21:9` | Cinematic |

OpenAI maps ratios to closest supported size (`1024x1024`, `1024x1536`, `1536x1024`).

## OpenAI Quality (gpt-image-1 only)

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

| Need | Use |
|------|-----|
| General image gen, highest quality | OpenAI `gpt-image-1.5` |
| Budget-friendly | OpenAI `gpt-image-1-mini` |
| Reference-based identity (same face) | Gemini (better at preserving identity from reference) |
| Image editing / inpainting | OpenAI edit mode (`--reference`) |
| Free tier / no OpenAI key | Gemini |

## Combining with Bella

For Bella-specific image generation (identity-locked, reference-based), use the bella skill's `bella-image-generation.md` workflow instead. This skill is for general-purpose image generation without persona constraints.
