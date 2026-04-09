---
name: content-strategy
description: "When the user wants to plan a content strategy, decide what content to create, figure out what topics to cover, or needs marketing ideas, growth tactics, and brainstorming. Also use when the user mentions 'content strategy,' 'what should I write about,' 'content ideas,' 'blog strategy,' 'topic clusters,' 'content planning,' 'editorial calendar,' 'content marketing,' 'content roadmap,' 'what content should I create,' 'blog topics,' 'content pillars,' 'I don't know what to write,' 'marketing ideas,' 'growth ideas,' 'how to market,' 'marketing strategies,' 'marketing tactics,' 'ways to promote,' 'ideas to grow,' 'what else can I try,' 'I don't know how to market this,' 'brainstorm marketing,' or 'what marketing should I do.' For writing individual pieces, see copywriting. For SEO-specific audits, see seo. For social media content specifically, see the marketing skill's social-content mode."
metadata:
  version: 2.0.0
---

# Content Strategy & Marketing Ideas

This skill routes to the appropriate sub-skill based on your request.

## Shared Context

If `.agents/product-marketing-context.md` exists (or `.claude/product-marketing-context.md` in older setups), read it first before proceeding.

## Routing

| Request Type | Route |
|---|---|
| Content planning, topic clusters, editorial calendar, content pillars, what to write about, content roadmap, keyword research, content prioritization | [strategy.md](strategy.md) |
| Marketing ideas, growth tactics, brainstorming, marketing strategies, ways to promote, how to market, what else can I try, marketing inspiration | [ideas.md](ideas.md) |

If the request spans both (e.g., "plan my content and give me marketing ideas"), use both sub-skills and synthesize a combined response.
