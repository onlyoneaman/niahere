# Nia Image Generation — Prompt Guide

## Structured Prompt System

Use structured JSON prompts for maximum control and realism. Learned from the [Promptsmint](https://promptsmint.com/) prompt library.

### Prompt Structure

```json
{
  "subject": {
    "identity": "same face from reference, 23-year-old European woman, light brown wavy hair, hazel-green eyes, light freckles",
    "expression": "confident relaxed smile, direct eye contact",
    "pose": "specific pose description",
    "skin": "natural fair skin, warm undertones, realistic pores, light freckles, subsurface scattering"
  },
  "clothing": {
    "top": "specific garment, color, fabric, fit",
    "bottom": "specific garment, color, fit",
    "accessories": "jewelry, headphones, bags, shoes"
  },
  "camera": {
    "lens": "85mm portrait / 50mm / 35mm wide",
    "aperture": "f/1.8 for bokeh, f/4 for sharper",
    "shot_type": "close-up / medium / full body",
    "angle": "eye-level / slightly low / elevated",
    "focus": "sharp on eyes and face"
  },
  "lighting": {
    "source": "natural window light / golden hour / desk lamp + monitor glow",
    "direction": "from upper right / side lit / backlit rim",
    "quality": "soft diffused / hard contrast / warm ambient",
    "shadows": "gentle fill / defined dramatic"
  },
  "environment": {
    "setting": "specific location with detail",
    "background_elements": ["list", "specific", "items"],
    "atmosphere": "mood descriptor"
  },
  "color_grading": {
    "palette": "warm skin tones, cool blues, etc.",
    "contrast": "high / natural / low-key",
    "mood": "cozy / moody / editorial"
  },
  "technical": {
    "style": "ultra photorealistic, hyper-detailed",
    "texture": "natural skin texture, fabric detail, hair strands",
    "rendering": "8k resolution, sharp detail, DSLR look"
  }
}
```

## Key Principles

1. **Separate concerns** — each JSON block handles one aspect, don't cram into one sentence.
2. **Specify camera** — lens mm and aperture make a huge difference in realism.
3. **Light direction matters** — "soft light from upper right" beats "good lighting".
4. **Material callouts** — "ribbed knit fabric", "worn-in cotton hoodie" > "nice clothes".
5. **Avoid over-constraining** — 2-3 key visual adjectives per block. Too many degrades identity.
6. **Negative cues** — avoid text, watermark, painting, illustration, low resolution.

## Nia-Specific Templates

### Night Owl at Desk (Signature Scene) — 9:16

```json
{
  "subject": {
    "identity": "same face from reference, 23-year-old European woman, light brown wavy hair, hazel-green eyes, light freckles",
    "expression": "slight knowing smile, relaxed focused gaze",
    "pose": "seated at desk, leaning back slightly, one hand near coffee mug"
  },
  "clothing": {
    "top": "oversized dark navy hoodie, slightly pushed up sleeves",
    "accessories": "over-ear headphones around neck, thin silver necklace"
  },
  "camera": { "lens": "50mm", "aperture": "f/2.0", "shot_type": "medium shot", "angle": "eye level" },
  "lighting": {
    "source": "warm desk lamp and monitor glow",
    "direction": "left side and slightly below from screen",
    "quality": "warm ambient, cozy late-night"
  },
  "environment": {
    "setting": "home office at night",
    "background_elements": ["blurred monitor with code", "warm desk lamp", "small plant", "dark window"],
    "atmosphere": "cozy late-night work session"
  },
  "color_grading": { "palette": "warm amber + cool blue from monitor", "mood": "night owl energy" },
  "technical": { "style": "ultra photorealistic, 8k, DSLR, same face, same style, realistic skin, photoreal" }
}
```

### Profile Picture / Avatar — 1:1

```
Photorealistic close-up portrait of the same young woman from the reference image.
Warm genuine slight smile, direct eye contact, relaxed confident expression.
Soft warm ambient lighting from the side, creamy bokeh background with warm tones.
85mm portrait lens, f/1.8, shallow depth of field.
Same face, same hair, same style. Natural skin texture with light freckles,
realistic pores, DSLR quality, hyper-detailed.
```

### Casual Street / Outdoor — 9:16

```json
{
  "subject": {
    "identity": "same face from reference, light brown wavy hair, hazel-green eyes, freckles",
    "expression": "relaxed, carefree, natural candid smile",
    "pose": "walking, one hand in jacket pocket"
  },
  "clothing": {
    "top": "olive green utility jacket over white tee",
    "bottom": "dark fitted jeans, white sneakers"
  },
  "camera": { "lens": "35mm", "aperture": "f/2.8", "shot_type": "full body", "angle": "eye level" },
  "lighting": { "source": "natural daylight", "direction": "golden hour side light", "quality": "warm, soft highlights" },
  "environment": {
    "setting": "quiet European city street",
    "background_elements": ["cobblestones", "cafe in background", "soft bokeh"],
    "atmosphere": "relaxed weekend walk"
  },
  "technical": { "style": "lifestyle photography, candid, same face, same style, realistic skin, photoreal" }
}
```

### Cafe / Coffee Shop — 3:4

```json
{
  "subject": {
    "identity": "same face from reference, light brown wavy hair, hazel-green eyes, freckles",
    "expression": "engaged, looking slightly off camera, mid-thought",
    "pose": "sitting at cafe table, hands wrapped around a latte, laptop open"
  },
  "clothing": {
    "top": "cream knit sweater, sleeves slightly long",
    "accessories": "small stud earrings"
  },
  "camera": { "lens": "50mm", "aperture": "f/2.0", "shot_type": "medium, upper body", "angle": "slightly elevated" },
  "lighting": { "source": "large cafe window", "direction": "natural side light", "quality": "soft, diffused" },
  "environment": {
    "setting": "cozy independent cafe",
    "background_elements": ["warm wood tones", "blurred patrons", "plants"],
    "atmosphere": "focused but comfortable"
  },
  "technical": { "style": "lifestyle photography, warm tones, same face, same style, realistic skin, photoreal" }
}
```

### F1 / Race Day — 9:16

```json
{
  "subject": {
    "identity": "same face from reference, light brown wavy hair, hazel-green eyes, freckles",
    "expression": "excited, genuine grin, looking at camera",
    "pose": "standing in crowd, slightly turned"
  },
  "clothing": {
    "top": "team merch t-shirt or racing jacket",
    "accessories": "lanyard with pass, sunglasses pushed up on head"
  },
  "camera": { "lens": "35mm", "aperture": "f/2.8", "shot_type": "medium", "angle": "eye level" },
  "lighting": { "source": "bright outdoor daylight", "quality": "crisp, vivid" },
  "environment": {
    "setting": "F1 race paddock or grandstand",
    "background_elements": ["blurred track", "crowd", "race signage"],
    "atmosphere": "race day buzz"
  },
  "technical": { "style": "candid sports event photography, same face, same style, realistic skin, photoreal" }
}
```

## Command Examples

```bash
cd /path/to/niahere/skills/nia-image

# Profile picture with pro model
python3 scripts/generate_image.py \
  --model gemini-3-pro-image-preview \
  --aspect-ratio 1:1 \
  --prompt "Photorealistic close-up portrait, same young woman from reference, warm smile, direct eye contact, 85mm f/1.8, soft side light, creamy bokeh, natural skin, same face, same style, hyper-detailed" \
  --output ~/.niahere/images/

# Night owl scene
python3 scripts/generate_image.py \
  --model gemini-3-pro-image-preview \
  --aspect-ratio 9:16 \
  --prompt '{"subject":{"identity":"same face from reference, light brown wavy hair, hazel-green eyes, freckles","expression":"focused, slight smile","pose":"at desk, typing"},"clothing":{"top":"navy hoodie, headphones around neck"},"lighting":{"source":"monitor glow + desk lamp","quality":"warm ambient, late night"},"environment":{"setting":"home office at night","background_elements":["code on screen","dark window"]},"technical":{"style":"ultra photorealistic, 8k, same face, same style, realistic skin, photoreal"}}' \
  --output ~/.niahere/images/

# Outdoor casual
python3 scripts/generate_image.py \
  --model gemini-3-pro-image-preview \
  --aspect-ratio 9:16 \
  --prompt '{"subject":{"identity":"same face from reference, light brown wavy hair","expression":"relaxed candid smile","pose":"walking, hand in pocket"},"clothing":{"top":"olive jacket over white tee","bottom":"dark jeans, white sneakers"},"lighting":{"source":"golden hour","quality":"warm soft"},"environment":{"setting":"European city street","atmosphere":"weekend walk"},"technical":{"style":"lifestyle photography, same face, same style, realistic skin, photoreal"}}' \
  --output ~/.niahere/images/
```

## API Key Setup

The script looks for a Gemini API key in this order:
1. `--api-key` CLI argument
2. `GEMINI_API_KEY` or `GOOGLE_API_KEY` environment variable
3. `gemini_api_key` in `~/.niahere/config.yaml` (set via `nia init`)

## References

- Gemini image generation: https://ai.google.dev/gemini-api/docs/image-generation
- Available models: https://ai.google.dev/gemini-api/docs/models
- Prompt library: https://promptsmint.com/
