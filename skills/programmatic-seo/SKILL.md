---
name: programmatic-seo
description: "Plans, audits, and implements scalable programmatic SEO systems with URL inventory, intent mapping, metadata, schema, internal linking, sitemaps, ISR/static rendering, and quality gates. Use when the user mentions 'programmatic SEO,' 'pSEO,' '100k pages,' 'generate SEO pages,' 'scaled landing pages,' 'template pages,' 'SEO page factory,' 'dynamic SEO routes,' 'sitemap shards,' 'keyword cannibalization,' 'doorway pages,' or 'thin content at scale.' Does not replace general SEO audits, AI SEO citation work, or llms.txt tasks unless PSEO scale is central."
---

# Programmatic SEO

## Core Rule

Turn PSEO requests into a gated system. A URL becomes indexable only after it has distinct intent, unique visible value, canonical consistency, crawlable links, and a measurable reason to stay live.

## First Checks

1. If `.agents/product-marketing-context.md` exists, read it before asking discovery questions.
2. If the task is a broad SEO audit without PSEO scale, invoke the `seo` skill instead.
3. If the user asks for current framework behavior, Google policy, or AI-search behavior, verify primary docs before relying on memory.

## Mode Selection

| Task | Read |
| --- | --- |
| Define page families, intent, uniqueness, doorway risk, cannibalization, hubs, or content blocks | [references/content-quality.md](references/content-quality.md) |
| Design the PSEO system: URL registry, statuses, metadata core, schema core, linking, sitemap model, facets | [references/architecture.md](references/architecture.md) |
| Inspect or optimize a Next.js app for PSEO: App Router, ISR, `generateStaticParams`, metadata, sitemaps, caching, build performance | [references/nextjs-inspection.md](references/nextjs-inspection.md) |
| Validate launch readiness, tests, Search Console checks, and monitoring | [references/validation.md](references/validation.md) |
| Ground claims in primary docs or source links | [references/sources.md](references/sources.md) |

## Output Shape

For audits, return:
- `Verdict`: whether the PSEO system is ready to scale.
- `Blockers`: issues that can harm crawl, indexation, quality, or build reliability.
- `Architecture`: recommended URL inventory, routing, rendering, metadata, schema, and sitemap structure.
- `Quality gates`: checks required before pages become indexable.
- `Implementation plan`: scoped code changes and verification steps.

For implementation, make the smallest code changes that establish durable guardrails. Prefer reusable SEO/data/template modules over inline page-level SEO logic.

## Hard Rules

- Scale only after a page pattern proves unique usefulness.
- Never create separate indexable URLs solely for plural/singular, synonym, query-fanout, or city/service keyword swaps.
- Never rely on `robots.txt` for deindexing or canonicalization.
- Never mark up schema that is not visible to users.
- Never include non-canonical, noindex, redirected, 404, or duplicate URLs in XML sitemaps.
- Never let arbitrary search, sort, filter, or facet combinations become indexable by default.
- Never promise that compliant pages will be indexed; treat indexation as an outcome to monitor.
