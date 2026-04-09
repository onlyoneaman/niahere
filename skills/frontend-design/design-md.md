# DESIGN.md — The Shared Design Language

DESIGN.md is a structured markdown file that encodes a project's entire visual identity in a format that humans and AI agents can both read and apply. It's not a config file — it's a shared language. A designer reads it and knows the palette. A developer reads it and knows the token names. An AI agent reads it and produces on-brand output every time.

## When This Skill Activates

1. **Any UI work** — Before writing UI code, check for `DESIGN.md` at project root or `docs/DESIGN.md`. If found, load it as your design constraints. If not found and the task is substantial, offer to create one.
2. **Explicit requests** — "create a design system", "extract the design tokens", "make a DESIGN.md", "audit design consistency"
3. **Cross-skill** — When `frontend-design` or any UI skill is active, check for DESIGN.md first. Its tokens override general principles.

## The Format

A DESIGN.md has up to 7 sections. Not all are required — a minimal file needs only Colors and Typography. Each section combines concrete values with design intent so agents understand both *what* and *why*.

### Canonical Structure

```markdown
# DESIGN.md

> One-line personality statement: "Warm, confident, editorial — not corporate."

## Colors

### Palette
| Token | Value | Usage |
|-------|-------|-------|
| primary | #2563eb | CTAs, links, active states |
| primary-hover | #1d4ed8 | Hover/pressed on primary |
| secondary | #7c3aed | Accents, badges, highlights |
| surface | #ffffff | Card/panel backgrounds |
| background | #f8f7f4 | Page background — warm off-white |
| text | #1a1a1a | Body text — soft black, not harsh |
| text-muted | #6b6b6b | Secondary text, captions |
| border | #e5e5e5 | Dividers, input borders |

### Semantic
| Token | Value | Usage |
|-------|-------|-------|
| success | #22c55e | Confirmations, positive states |
| error | #ef4444 | Errors, destructive actions |
| warning | #f59e0b | Cautions, pending states |
| info | #3b82f6 | Informational callouts |

> Intent: The palette is warm and approachable. Avoid pure white (#fff)
> and pure black (#000) — they feel harsh. Off-whites and soft darks
> create depth without sterility.

## Typography

### Fonts
- **Heading:** 'Instrument Serif', serif — editorial weight, personality
- **Body:** 'DM Sans', sans-serif — clean, readable, modern

### Scale
| Role | Size | Weight | Line Height | Letter Spacing |
|------|------|--------|-------------|----------------|
| display | 3rem | 700 | 1.1 | -0.02em |
| h1 | 2.25rem | 700 | 1.15 | -0.01em |
| h2 | 1.75rem | 600 | 1.2 | 0 |
| h3 | 1.25rem | 600 | 1.3 | 0 |
| body | 1rem | 400 | 1.6 | 0 |
| body-sm | 0.875rem | 400 | 1.5 | 0 |
| caption | 0.75rem | 500 | 1.4 | 0.02em |

> Intent: Serif headings + sans body creates editorial contrast.
> Type scale has clear hierarchy — don't use sizes between these steps.

## Spacing

### Scale
| Token | Value |
|-------|-------|
| xs | 0.25rem (4px) |
| sm | 0.5rem (8px) |
| md | 1rem (16px) |
| lg | 1.5rem (24px) |
| xl | 2rem (32px) |
| 2xl | 3rem (48px) |
| 3xl | 5rem (80px) |

**Base unit:** 4px. All spacing is a multiple of 4.

> Intent: Consistent rhythm. Don't invent in-between values.
> When in doubt, go with more whitespace, not less.

## Layout

- **Page max-width:** 1200px
- **Content max-width:** 65ch (readable line length)
- **Grid:** 12-column, 24px gutter
- **Breakpoints:**
  - sm: 640px
  - md: 768px
  - lg: 1024px
  - xl: 1440px

## Radius & Shadows

| Token | Value | Usage |
|-------|-------|-------|
| radius-sm | 4px | Inputs, small elements |
| radius-md | 8px | Cards, buttons |
| radius-lg | 16px | Modals, large panels |
| radius-full | 9999px | Pills, avatars |
| shadow-sm | 0 1px 2px rgba(0,0,0,0.05) | Subtle lift |
| shadow-md | 0 4px 12px rgba(0,0,0,0.08) | Cards, dropdowns |
| shadow-lg | 0 12px 32px rgba(0,0,0,0.12) | Modals, popovers |

## Components

Document recurring UI patterns with their token usage and states.

### Button
- **Primary:** bg-primary, text-white, radius-md, font-weight 600
  - Hover: bg-primary-hover
  - Disabled: opacity 50%, cursor not-allowed
  - Focus: 2px ring, primary with 50% opacity, offset 2px
- **Secondary:** bg-transparent, border 1px border-color, text-text, radius-md
- **Ghost:** bg-transparent, text-primary, no border
  - Hover: bg-primary at 5% opacity
- **Destructive:** bg-error, text-white, radius-md

### Card
- bg-surface, radius-md, shadow-sm
- Padding: lg (24px)
- Border: 1px border-color (optional — use when cards are on surface-colored bg)

### Input
- Height: 40px, padding-x: sm, radius-sm
- Border: 1px border-color
- Focus: border-primary, ring 2px primary at 20% opacity
- Error: border-error, ring 2px error at 20% opacity
- Label: caption size, text-muted, margin-bottom xs

> Extend this section as new components are introduced.
> Every component added here becomes a constraint for future generation.

## Dark Mode (optional)

If supported, define the token overrides:

| Token | Light | Dark |
|-------|-------|------|
| background | #f8f7f4 | #1a1a1a |
| surface | #ffffff | #262626 |
| text | #1a1a1a | #f0f0f0 |
| text-muted | #6b6b6b | #a3a3a3 |
| border | #e5e5e5 | #404040 |
```

---

## Reading a DESIGN.md

When you find a DESIGN.md in a project:

1. **Internalize it fully** before writing any UI code
2. **Use only its tokens** — don't introduce colors, fonts, or spacing not in the file
3. **Respect the intent notes** — they tell you the spirit, not just the letter
4. **Identify gaps** — if you need something not covered, make a choice consistent with the system's personality and offer to add it to DESIGN.md
5. **Never silently deviate** — if you must break from the system, say why

## Creating a DESIGN.md

### From an Existing Codebase

1. Scan for design tokens: CSS custom properties, Tailwind config, theme files, styled-components themes, SCSS variables
2. Scan for font imports: Google Fonts links, @font-face declarations, font family usage
3. Scan for recurring values: grep for hex colors, rem/px spacing values, border-radius, box-shadow
4. Organize findings into the canonical structure
5. Add intent notes based on patterns you observe
6. Flag inconsistencies: "Found 4 different grays — consolidating to 3 tokens"

### From a Live Site (via Playwright)

1. Navigate to the URL
2. Extract computed styles from key elements: headings, body, buttons, cards, inputs, nav
3. Pull the color palette from most-used colors
4. Identify font families and weights in use
5. Measure spacing patterns between elements
6. Organize into canonical structure
7. Ask the user to confirm/adjust before finalizing

### From Scratch

Walk the user through decisions:

1. **Personality** — "What should this feel like? (minimal / bold / editorial / playful / technical / warm)"
2. **Color direction** — "Warm or cool? Vibrant or muted? Any brand colors to anchor on?"
3. **Typography** — Suggest 2-3 font pairings that match the personality. Ask the user to pick.
4. **Density** — "Spacious and editorial, or compact and information-dense?"
5. Generate the full DESIGN.md from their answers
6. Offer to generate the corresponding framework config (Tailwind, CSS vars, etc.)

### From a Stitch Export

Stitch exports DESIGN.md natively. If a user brings one:

1. Read it as-is — the format is compatible
2. Check for completeness against the canonical structure
3. Suggest additions for any missing sections
4. No Stitch account or MCP needed — it's just markdown

## Applying a DESIGN.md

### Translating to Framework Configs

When asked, or when setting up a new project with a DESIGN.md:

**Tailwind (tailwind.config.js):**
```js
// Map DESIGN.md tokens to Tailwind theme
theme: {
  colors: {
    primary: '#2563eb',
    'primary-hover': '#1d4ed8',
    // ... from Colors section
  },
  fontFamily: {
    heading: ['Instrument Serif', 'serif'],
    body: ['DM Sans', 'sans-serif'],
  },
  spacing: {
    xs: '0.25rem',
    sm: '0.5rem',
    // ... from Spacing section
  },
  borderRadius: {
    sm: '4px',
    md: '8px',
    // ... from Radius section
  }
}
```

**CSS Custom Properties:**
```css
/* Generated from DESIGN.md */
:root {
  --color-primary: #2563eb;
  --font-heading: 'Instrument Serif', serif;
  --space-md: 1rem;
  /* ... all tokens */
}
```

Generate the format that matches the project's stack. Don't generate configs the project won't use.

### Constraining UI Output

When building components with an active DESIGN.md:

- **Colors:** Only use defined palette tokens. If you need a shade not listed, derive it from the nearest token and note it.
- **Typography:** Only use defined font/size/weight combinations. Don't invent intermediate sizes.
- **Spacing:** Only use scale values. No arbitrary px/rem values.
- **Components:** If the component is documented, follow its spec exactly. If not, compose from existing tokens consistent with documented components.
- **Intent:** Read the `>` blockquote notes. They tell you what the designer was thinking. Honor that.

## Evolving a DESIGN.md

### When to Update

- New component pattern is introduced that will recur
- A new color/token is needed that the system doesn't cover
- An existing token is wrong or unused
- The design direction shifts

### How to Update

1. Propose the change to the user before writing it
2. Add to the appropriate section, maintaining table format
3. Include intent notes for non-obvious additions
4. If removing a token, grep the codebase first to confirm it's unused

### Drift Audit

When asked to audit, or periodically during large UI work:

1. Grep the codebase for hardcoded colors, fonts, spacing not in DESIGN.md
2. Compare component implementations against their specs
3. Report deviations with file:line references
4. Suggest whether to update the code or update DESIGN.md

## Integration Protocol

**For other skills referencing this one:**

```
Before generating UI:
  1. Check for DESIGN.md at project root or docs/DESIGN.md
  2. If found -> read it, use its tokens as constraints
  3. If not found -> for substantial UI work, ask:
     "This project doesn't have a DESIGN.md yet. Want me to
      create one? It'll keep the UI consistent across everything
      we build. I can extract one from the existing code, from
      a reference site, or we can define one from scratch."
  4. If user declines -> proceed with general principles
```
