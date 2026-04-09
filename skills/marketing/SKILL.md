---
name: marketing
description: "When the user wants help with marketing, growth, GTM, or getting users. Covers pricing strategy, competitor comparison pages, social media content, product launches, and churn prevention. Also use when the user mentions 'marketing,' 'growth,' 'GTM,' 'go-to-market,' 'how to get users,' 'marketing strategy,' 'pricing,' 'competitor page,' 'vs page,' 'alternative page,' 'social media,' 'LinkedIn post,' 'Twitter thread,' 'launch,' 'Product Hunt,' 'churn,' 'cancel flow,' 'dunning,' 'retention,' 'failed payments,' or 'how do I market this.' For copywriting, CRO, SEO, email, content strategy, and customer research, use the dedicated top-level skills."
metadata:
  version: 2.0.0
---

# Marketing

Routes to the right marketing sub-skill based on your request.

## Before Starting

**Check for product marketing context first:**
If `.agents/product-marketing-context.md` exists (or `.claude/product-marketing-context.md` in older setups), read it before asking questions. Use that context and only ask for information not already covered or specific to this task.

## Mode Selection

| Need | File |
|------|------|
| Pricing, packaging, monetization, pricing tiers | [pricing-strategy.md](pricing-strategy.md) |
| Competitor comparison pages, vs pages, alternative pages | [competitor-alternatives.md](competitor-alternatives.md) |
| Social media content (LinkedIn, Twitter, TikTok, etc.) | [social-content.md](social-content.md) |
| Product launch, feature announcement, go-to-market | [launch-strategy.md](launch-strategy.md) |
| Churn reduction, cancel flows, dunning, retention | See churn section below |

## Churn Prevention

Churn has its own sub-modes. First read [churn-prevention.md](churn-prevention.md), which routes to:
- [churn-cancel-flows.md](churn-cancel-flows.md) — exit surveys, save offers, UI patterns
- [churn-prediction.md](churn-prediction.md) — risk signals, health scores
- [churn-dunning.md](churn-dunning.md) — payment recovery, retry logic

## Related Top-Level Skills

These are dedicated skills for common marketing tasks — invoke them directly:
- `copywriting` — page copy, headlines, CTAs, editing
- `cro` — page, signup flow, onboarding conversion optimization
- `seo` — traditional SEO, AI SEO, llms.txt
- `email` — cold outreach, lifecycle sequences
- `content-strategy` — content planning, marketing ideas
- `customer-research` — interviews, surveys, VOC analysis
- `product-marketing-context` — foundational positioning (set this up first)
