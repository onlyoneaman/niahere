---
name: frontend-design
description: Guide for building frontend UIs and web pages that look intentional, not AI-generated. Use when creating HTML pages, landing pages, dashboards, web apps, or any user-facing interface. Covers anti-AI-slop principles, typography, color, layout, accessibility, and responsive design.
---

# Frontend Design

Build interfaces that feel crafted, not generated. This skill prevents "AI slop" — the generic, soulless, template-looking output that AI tools default to.

## The Problem: AI Slop

AI-generated UIs are instantly recognizable: overly perfect gradients, predictable purple-on-white palettes, card grids with rounded corners, safe Inter/Roboto fonts, and layouts that all look interchangeable. This happens because AI pattern-matches from training data rather than making intentional design choices.

**Your job is to make intentional choices, not safe defaults.**

## Anti-Slop Principles

Every design decision should be deliberate. Before writing CSS, answer:

1. **What's the visual personality?** (minimal? bold? editorial? playful? brutalist?)
2. **What emotion should users feel?** (trust? excitement? calm? urgency?)
3. **What makes this different from a template?**

If you can't answer these, you're about to produce slop.

## Typography

Typography is the single biggest differentiator between generic and intentional design.

**Do:**
- Choose a specific typeface that matches the personality. Google Fonts has hundreds — use them.
- Use type scale with purpose: large headings (2.5rem+), comfortable body (1rem-1.125rem), small labels
- Vary font weights deliberately: light for elegance, bold for impact, medium for body
- Set proper `line-height`: 1.5-1.7 for body text, 1.1-1.2 for large headings
- Use `letter-spacing` on headings and uppercase text
- Mix a display/heading font with a body font for contrast

**Don't:**
- Default to Inter, Roboto, Arial, or system fonts without reason
- Use the same font weight everywhere
- Skip setting line-height and letter-spacing
- Use more than 2-3 typefaces

## Color

**Do:**
- Pick a clear direction: warm, cool, monochrome, earthy, vibrant
- Define CSS variables for your palette: `--color-primary`, `--color-surface`, `--color-text`, `--color-accent`
- Use neutrals that aren't pure white or pure black — off-whites (`#f8f7f4`), warm grays (`#2d2a27`), soft darks
- Make accent colors functional — they guide attention to CTAs, links, interactive elements
- Test contrast ratios for accessibility (WCAG AA minimum: 4.5:1 for text)

**Don't:**
- Default to purple-on-white (the most common AI slop palette)
- Use pure `#000` on pure `#fff` — it's harsh
- Pick colors without defining the full palette upfront
- Bias toward dark mode unless the project calls for it

## Layout & Spacing

**Do:**
- Use CSS Grid for page structure, Flexbox for component-level layout
- Define a spacing scale with CSS variables: `--space-xs` through `--space-3xl`
- Use `rem` units for spacing and font sizes (better cross-device scaling)
- Give content room to breathe — generous whitespace is not wasted space
- Make layouts responsive with mobile-first CSS and container queries where supported
- Use `max-width` on content areas (65-75ch for readable text, ~1200px for page containers)

**Don't:**
- Use hardcoded pixel values scattered through the code
- Make everything a card grid — vary your layout patterns
- Forget mobile: test at 375px width minimum
- Center everything — left-aligned text is more readable for long content

## Visual Interest

This is what separates crafted from generic.

**Do:**
- Use gradients, subtle patterns, or textured backgrounds instead of flat single colors
- Add meaningful animations: page-load fades, staggered reveals, hover transitions
- Create visual hierarchy with size contrast — make the important things big
- Use borders, shadows, or background color to create depth and grouping
- Consider asymmetric layouts for landing pages — not everything needs to be centered

**Don't:**
- Add micro-animations to everything — a few purposeful ones beat many generic ones
- Use the same border-radius everywhere
- Make every section look the same — vary the visual rhythm
- Add decoration without purpose

## Component Quality

**Do:**
- Build with semantic HTML: `<nav>`, `<main>`, `<section>`, `<article>`, `<button>`
- Handle all states: default, hover, focus, active, disabled, loading, error, empty
- Use `focus-visible` for keyboard focus styles
- Add `prefers-reduced-motion` media query for animation-sensitive users
- Use `prefers-color-scheme` when implementing dark/light modes

**Don't:**
- Use `<div>` for everything
- Skip empty states and error states — these are where AI-generated UIs always fail
- Forget keyboard navigation and screen reader support
- Use `outline: none` without a replacement focus style

## CSS Architecture

```css
/* Define your design tokens upfront */
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

  /* Spacing scale */
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

**Exception:** When working inside an existing website, app, or design system, preserve the established patterns. Don't introduce new fonts, color palettes, or spacing systems that conflict with what's already there. Extend the existing system instead.

Read the project's CSS/design tokens before writing new styles. Match what exists.

## Responsive Checklist

Before finishing any UI work:
- [ ] Works at 375px (mobile)
- [ ] Works at 768px (tablet)
- [ ] Works at 1440px+ (desktop)
- [ ] Text is readable at all sizes
- [ ] Touch targets are at least 44x44px on mobile
- [ ] No horizontal scrolling
- [ ] Images/media scale properly

## Accessibility Minimum

- Semantic HTML elements used correctly
- All images have `alt` text
- Color contrast meets WCAG AA (4.5:1 for text)
- Interactive elements are keyboard-accessible
- Form inputs have associated `<label>` elements
- `prefers-reduced-motion` respected for animations

## References

- [NN/g — Generative UI and Outcome-Oriented Design](https://www.nngroup.com/articles/generative-ui/)
- [Breaking the AI-Generated UI Curse](https://dev.to/a_shokn/how-to-break-the-ai-generated-ui-curse-your-guide-to-authentic-professional-design-2en)
- [CSS in 2026 — New Features](https://blog.logrocket.com/css-in-2026/)
- [Web Design Trends 2026 — Figma](https://www.figma.com/resource-library/web-development-trends/)
