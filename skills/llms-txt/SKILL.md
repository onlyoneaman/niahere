---
name: llms-txt
description: Expert guidance for creating, improving, and maintaining llms.txt/llms-full.txt for LLM-aware content indexing and AI retrieval.
argument-hint: "[path] [goal]"
license: MIT
metadata:
  author: aman
  version: "1.0.0"
---

# llms.txt Skill

Use this skill when the user asks to create, review, improve, or scale `llms.txt`/`llms-full.txt` for a site, docs portal, or product.

## Goals

- Explain what `llms.txt` is and when to use it.
- Help write high-signal, low-noise link collections for AI readers.
- Improve existing files with ranking/order, scope, freshness, and maintainability changes.
- Provide tooling and review checks to prevent low-quality output.

## Runtime Scope

- Works for any static or dynamic site.
- Can be used alongside SEO artifacts (`robots.txt`, `sitemap.xml`, `robots` metadata); it is **not** a replacement.
- Use when the ask is about discoverability for AI systems, docs quality for retrieval, or reducing crawl noise for model context.

## What `llms.txt` Is

- A curated, human-readable index intended for machine readers.
- A concise map of authoritative pages, organized by topic.
- A guidance file, not a permission file:
  - It does not grant permission or block crawling.
  - It signals what content is high value.

## Who This Helps

- Content/site owners who want AI systems to prioritize reliable pages.
- Product teams building LLM-powered assistants/crawlers.
- Internal teams maintaining docs, knowledge bases, and API references.
- External integrators that consume public docs and need stable entry points.

## Why It Helps

- Reduces ambiguity by exposing intent: what should be read first.
- Improves consistency of summaries and question-answering quality from your site.
- Helps new models/tools avoid outdated, low-value, and duplicate pages.
- Supports faster onboarding for AI agents and copilots that consume your site.

## Core Rules

1. Keep the file short and opinionated.
2. Use a stable order: high-level entry first, then deeper pages.
3. Group by purpose (`Overview`, `Getting Started`, `Core`, `API`, `Projects`, etc.).
4. Use clear one-line descriptions for each link.
5. Prefer canonical URLs and remove dead/redirected links.
6. Mark lower-priority links as optional.
7. Update with every meaningful content change.

## Standard Authoring Pattern

```
# Site or Product Name

> One-line description of what the site provides.

## Overview
- [Home](https://example.com/) : What this website is and who it serves.
- [About](https://example.com/about) : Core context and mission.

## Core documentation
- [Getting Started](https://example.com/docs/getting-started) : Setup and onboarding path.
- [Concepts](https://example.com/docs/concepts) : Key ideas and mental models.

## Projects / Products
- [Project Index](https://example.com/projects) : Curated project list.
- [Featured Project](https://example.com/projects/featured-project) : High-priority example.

## Optional
- [Blog](https://example.com/blog) : Current essays; useful but not required for basic understanding.
```

## Writing `llms.txt` (Step-by-step)

1. Define audience and primary task (e.g., onboarding, evaluation, API usage, portfolio review).
2. Select 10-30 high-signal URLs only.
3. Add required top-level sections:
   - `#` title
   - `##` grouped headings
   - bullet list links with short purpose text
4. Order by usefulness for first-pass understanding.
5. Mark noisy or secondary pages under `## Optional`.
6. Validate all links and prune stale pages.
7. Track version updates in repo changelog or notes.

## Improve Existing `llms.txt`

- Remove dead pages and broken links.
- Consolidate repeated or overlapping pages.
- Move outdated material to `llms-full.txt` if too large for primary file.
- Keep first section reserved for decision-making pages.
- Add or refresh descriptions when APIs/features move.
- Add explicit entry for changelogs or release notes if they affect understanding.
- Re-rank links to surface most important pages first.

## Validation Checklist

- File is plain text/markdown and accessible at `/llms.txt`.
- No marketing fluff; every bullet is actionable/identifying.
- Descriptions are factual and specific.
- URLs are absolute, canonical, and reachable.
- No duplicate links across sections.
- Total size is practical (start lean, grow with scale).

## Next.js / Vercel Example

- Add file at `public/llms.txt`.
- Keep it in git with your content updates.
- Optional: generate periodically from a docs manifest if your site grows quickly.

## Common Mistakes

- Treating it as SEO replacement.
- Adding a giant full list of all pages.
- Using vague descriptions like "click here".
- Outdated links after page moves.
- Mixing private/internal URLs with public consumption targets.

## Additional Files

- Optional: `llms-full.txt` for exhaustive references only when needed.
- Optional: `llms-<area>.txt` variants for domain-specific sections.

## Resources to Explore

- llms.txt proposal: https://llmstxt.org/
- llms.txt repository: https://github.com/AnswerDotAI/llms-txt
- llms.txt parser/usage notes: https://github.com/AnswerDotAI/llms-txt/blob/main/README.md
- AI content discoverability baseline (model context quality): https://www.sitemaps.org/protocol.html
- Crawling guidance reference: https://developers.google.com/search/docs/crawling-indexing/overview
- Robots standard: https://developers.google.com/search/docs/crawling-indexing/robots/robots_txt
