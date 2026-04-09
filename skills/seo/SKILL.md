---
name: seo
description: "When the user wants to improve search visibility — traditional SEO audits, AI search optimization, or llms.txt creation. Use when the user mentions 'SEO,' 'technical SEO,' 'AI SEO,' 'AEO,' 'GEO,' 'LLMO,' 'answer engine optimization,' 'generative engine optimization,' 'LLM optimization,' 'AI Overviews,' 'optimize for ChatGPT,' 'optimize for Perplexity,' 'AI citations,' 'AI visibility,' 'zero-click search,' 'LLM mentions,' 'optimize for Claude/Gemini,' 'SEO audit,' 'why am I not ranking,' 'SEO issues,' 'on-page SEO,' 'meta tags review,' 'SEO health check,' 'my traffic dropped,' 'lost rankings,' 'not showing up in Google,' 'site isn't ranking,' 'Google update hit me,' 'page speed,' 'core web vitals,' 'crawl errors,' 'indexing issues,' 'llms.txt,' 'llms-full.txt,' 'LLM-aware indexing,' 'AI retrieval,' or 'my SEO is bad.'"
metadata:
  version: 2.0.0
---

# SEO

Unified skill for all search visibility work. Route to the appropriate sub-skill based on the user's goal.

## Shared Context

If `.agents/product-marketing-context.md` exists, read it first before proceeding with any sub-skill.

## Routing Table

| User Goal | Sub-skill |
|-----------|-----------|
| Traditional/technical SEO — audits, rankings, crawlability, on-page optimization, site speed, Core Web Vitals, indexing issues, traffic drops | [traditional.md](traditional.md) |
| AI search optimization — getting cited by LLMs, AI Overviews, ChatGPT/Perplexity/Gemini visibility, AEO/GEO/LLMO | [ai-seo.md](ai-seo.md) |
| llms.txt creation — creating, improving, or maintaining llms.txt/llms-full.txt files for LLM-aware content indexing | [llms-txt.md](llms-txt.md) |

## Disambiguation

- "SEO audit" or "why am I not ranking" or "my traffic dropped" → **traditional.md**
- "Show up in AI answers" or "AI search" or "optimize for ChatGPT" → **ai-seo.md**
- "Create llms.txt" or "LLM indexing file" → **llms-txt.md**
- "Full SEO review" → Start with **traditional.md**, then recommend **ai-seo.md** as a follow-up
- If unclear, ask the user whether they mean traditional search engines, AI search, or both
