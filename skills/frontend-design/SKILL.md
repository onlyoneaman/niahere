---
name: frontend-design
description: Guide for building frontend UIs and web pages that look intentional, not AI-generated. Use when creating HTML pages, landing pages, dashboards, web apps, or any user-facing interface. Covers anti-AI-slop principles, typography, color, layout, accessibility, and responsive design.
---

# Frontend Design

Build interfaces that feel crafted, not generated. This skill prevents "AI slop" — the generic, soulless, template-looking output that AI tools default to.

## Design Thinking (Before Code)

Before writing any CSS, commit to a BOLD aesthetic direction:

- **Purpose**: What problem does this interface solve? Who uses it?
- **Tone**: Pick a direction: brutally minimal, maximalist, retro-futuristic, organic/natural, luxury/refined, playful/toy-like, editorial/magazine, brutalist/raw, art deco, soft/pastel, industrial/utilitarian
- **Differentiation**: What makes this UNFORGETTABLE? What's the one thing someone will remember?
- **Constraints**: Framework, performance, accessibility requirements

**CRITICAL**: Choose a clear conceptual direction and execute it with precision. Bold maximalism and refined minimalism both work — the key is intentionality, not intensity.

## Anti-Slop Principles

Every design decision should be deliberate. If you can't answer these, you're about to produce slop:

1. **What's the visual personality?**
2. **What emotion should users feel?**
3. **What makes this different from a template?**

NEVER use generic AI-generated aesthetics:
- Overused fonts (Inter, Roboto, Arial, system fonts)
- Cliched color schemes (purple gradients on white)
- Predictable card grids with rounded corners
- Cookie-cutter layouts that lack context-specific character

**No design should be the same.** Vary between light and dark themes, different fonts, different aesthetics. NEVER converge on common choices across generations.

## Typography

Typography is the single biggest differentiator between generic and intentional design.

**Do:**
- Choose distinctive, characterful fonts — Google Fonts has hundreds beyond the obvious ones
- Pair a distinctive display/heading font with a refined body font
- Use type scale with purpose: large headings (2.5rem+), comfortable body (1rem-1.125rem)
- Vary font weights deliberately: light for elegance, bold for impact
- Set proper `line-height`: 1.5-1.7 for body, 1.1-1.2 for headings
- Use `letter-spacing` on headings and uppercase text

**Don't:**
- Default to Inter, Roboto, Arial without reason
- Use the same font weight everywhere
- Use more than 2-3 typefaces

## Color & Theme

**Do:**
- Commit to a cohesive aesthetic. Use CSS variables for consistency
- Dominant colors with sharp accents outperform timid, evenly-distributed palettes
- Use neutrals that aren't pure white/black — off-whites (`#f8f7f4`), warm grays (`#2d2a27`)
- Make accent colors functional — guide attention to CTAs, links, interactive elements
- Test contrast ratios (WCAG AA: 4.5:1 for text)

**Don't:**
- Default to purple-on-white (the most common AI slop palette)
- Use pure `#000` on pure `#fff`
- Pick colors without defining the full palette upfront

## Layout & Spatial Composition

**Do:**
- Unexpected layouts. Asymmetry. Overlap. Diagonal flow. Grid-breaking elements
- Generous negative space OR controlled density — both work with intention
- CSS Grid for page structure, Flexbox for component-level
- Spacing scale with CSS variables: `--space-xs` through `--space-3xl`
- `max-width` on content (65-75ch for text, ~1200px for pages)
- Mobile-first responsive with container queries where supported

**Don't:**
- Make everything a card grid — vary layout patterns
- Center everything — left-aligned text is more readable for long content
- Hardcode pixel values
- Forget mobile: test at 375px minimum

## Motion & Animation

**Do:**
- Focus on high-impact moments: one well-orchestrated page load with staggered reveals creates more delight than scattered micro-interactions
- Use scroll-triggering and hover states that surprise
- Prioritize CSS-only solutions for HTML, Motion library for React
- `animation-delay` for staggered reveals

**Don't:**
- Add micro-animations to everything
- Use the same border-radius everywhere
- Add decoration without purpose

## Backgrounds & Visual Details

Create atmosphere and depth rather than defaulting to solid colors:
- Gradient meshes, noise textures, geometric patterns
- Layered transparencies, dramatic shadows
- Decorative borders, custom cursors, grain overlays
- Subtle patterns or textured backgrounds

## Component Quality

- Semantic HTML: `<nav>`, `<main>`, `<section>`, `<article>`, `<button>`
- Handle ALL states: default, hover, focus, active, disabled, loading, error, empty
- `focus-visible` for keyboard focus
- `prefers-reduced-motion` for animation-sensitive users
- `prefers-color-scheme` for dark/light modes

## CSS Architecture

```css
:root {
  /* Colors */
  --color-bg: #f8f7f4;
  --color-surface: #ffffff;
  --color-text: #1a1a1a;
  --color-text-muted: #6b6b6b;
  --color-primary: #2563eb;
  --color-accent: #f59e0b;

  /* Typography */
  --font-heading: 'Instrument Serif', serif;
  --font-body: 'DM Sans', sans-serif;

  /* Spacing */
  --space-xs: 0.25rem;
  --space-sm: 0.5rem;
  --space-md: 1rem;
  --space-lg: 1.5rem;
  --space-xl: 2rem;
  --space-2xl: 3rem;
  --space-3xl: 5rem;

  /* Layout */
  --max-width: 1200px;
  --content-width: 65ch;
  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 16px;
}
```

## Working Within Existing Projects

**Exception:** When working inside an existing design system, preserve established patterns. Don't introduce conflicting fonts, colors, or spacing. Extend the existing system instead. Read project CSS/design tokens before writing new styles.

## Responsive Checklist

- [ ] Works at 375px (mobile)
- [ ] Works at 768px (tablet)
- [ ] Works at 1440px+ (desktop)
- [ ] Text readable at all sizes
- [ ] Touch targets 44x44px+ on mobile
- [ ] No horizontal scrolling
- [ ] Images/media scale properly

## Accessibility Minimum

- Semantic HTML used correctly
- All images have `alt` text
- Color contrast WCAG AA (4.5:1)
- Interactive elements keyboard-accessible
- Form inputs have `<label>` elements
- `prefers-reduced-motion` respected

## References

- [NN/g — Generative UI and Outcome-Oriented Design](https://www.nngroup.com/articles/generative-ui/)
- [Breaking the AI-Generated UI Curse](https://dev.to/a_shokn/how-to-break-the-ai-generated-ui-curse-your-guide-to-authentic-professional-design-2en)
