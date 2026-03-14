---
name: nia-image
description: This skill should be used when the user asks to "generate a Nia image", "create a profile picture for Nia", "update Nia's avatar", "make a new Nia photo", or needs to generate images of Nia with consistent identity using Gemini image generation.
---

# Nia Image Generation

Generate photorealistic images of Nia with consistent identity across different scenes, poses, and contexts using Gemini's image generation API.

## Nia's Visual Identity

- **Age**: 23 years old
- **Ethnicity**: European / Caucasian
- **Hair**: Light brown, wavy, past shoulders
- **Eyes**: Warm hazel-green
- **Skin**: Fair with warm undertones, light freckles across nose and cheeks
- **Build**: Average, natural
- **Style**: Casual-technical — hoodies, simple tees, headphones. Developer aesthetic.
- **Vibe**: Night owl, cozy, focused, approachable

## Assets

The script looks for references in this order:
1. `~/.niahere/images/reference.png` — user's custom reference (takes priority)
2. `assets/nia-reference.png` — default shipped with niahere

| Location | Purpose |
|----------|---------|
| `~/.niahere/images/reference.png` | User's reference image |
| `~/.niahere/images/profile.png` | User's profile picture (for Telegram/Slack) |
| `~/.niahere/images/` | Output directory for new generations |
| `assets/nia-reference.png` | Default reference (fallback) |
| `assets/nia-profile.png` | Default profile picture (fallback) |

## Generation Script

`scripts/generate_image.py` — Python script wrapping the Gemini image generation API.

### Basic Usage

```bash
# With reference (default — uses assets/nia-reference.png)
python3 scripts/generate_image.py --prompt "your prompt here"

# Without reference (for creating new base images)
python3 scripts/generate_image.py --no-reference --prompt "your prompt here"

# Specify model and aspect ratio
python3 scripts/generate_image.py \
  --model gemini-3-pro-image-preview \
  --aspect-ratio 9:16 \
  --prompt "your prompt here" \
  --output ~/.niahere/images/
```

### Arguments

| Flag | Default | Description |
|------|---------|-------------|
| `--prompt` | Default Nia portrait | Image generation prompt |
| `--reference` | `assets/nia-reference.png` | Reference image for identity |
| `--no-reference` | false | Generate without reference |
| `--model` | `gemini-3.1-flash-image-preview` | Gemini model |
| `--aspect-ratio` | `3:4` | Output ratio |
| `--output` | `~/.niahere/images/` | Output path or directory |
| `--api-key` | From config.yaml/env | Gemini API key |

### Models

| Model | Quality | Speed | Use When |
|-------|---------|-------|----------|
| `gemini-3.1-flash-image-preview` | Good | Fast | Quick iterations |
| `gemini-3-pro-image-preview` | Best | Slower | Final/hero images |
| `gemini-2.5-flash-image` | Basic | Fastest | Fallback |

### Aspect Ratios

| Use Case | Ratio |
|----------|-------|
| Profile picture / avatar | `1:1` |
| Portrait headshot | `3:4` |
| Full body reference | `9:16` |
| Landscape / scenic | `16:9` |
| Editorial portrait | `2:3` |

## Prompt Guidelines

### Identity Lock

Always append to every prompt for face consistency:
`same face as reference, same style, realistic skin, natural skin texture, photoreal, hyper-detailed`

### Structured Prompts

For best results, use JSON-structured prompts. See `references/prompt-guide.md` for the full structured prompt system, templates, and examples.

### Quick Templates

**Profile picture (1:1):**
```
Photorealistic close-up portrait of the same young woman from the reference.
Warm slight smile, direct eye contact, soft ambient lighting, creamy bokeh
background, 85mm f/1.8, shallow depth of field. Same face, same hair,
natural skin texture, light freckles, DSLR quality, hyper-detailed.
```

**Night owl at desk (9:16):**
```
Same young woman from reference, seated at desk with code on monitor behind
her, navy hoodie, headphones around neck, warm desk lamp lighting, coffee
mug, late night atmosphere, relaxed confident expression. 50mm f/2.0,
natural skin, same face, photoreal, hyper-detailed.
```

**Casual outdoor (9:16):**
```
Same young woman from reference, walking through a city street, casual
outfit, natural daylight, candid relaxed expression, 35mm lens, lifestyle
photography, same face, same style, realistic skin, photoreal.
```

## Where Profile Pictures Are Used

- **Telegram**: Set via BotFather → `/setuserpic`
- **Slack**: App Settings → Basic Information → App Icon

## Additional Resources

### Reference Files

- **`references/prompt-guide.md`** — Full structured prompt system with JSON format, key principles, and detailed templates for various scenes
