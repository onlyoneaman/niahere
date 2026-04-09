---
name: cro
description: "When the user wants to optimize conversions at any stage of the funnel — marketing pages, signup flows, or post-signup onboarding. Also use when the user mentions 'CRO,' 'conversion rate optimization,' 'this page isn't converting,' 'improve conversions,' 'low conversion rate,' 'bounce rate,' 'signup conversions,' 'registration friction,' 'signup form optimization,' 'people aren't signing up,' 'signup abandonment,' 'onboarding flow,' 'activation rate,' 'user activation,' 'first-run experience,' 'empty states,' 'users sign up but don't use the product,' 'time to value,' 'nobody completes setup,' 'reduce signup dropoff,' or 'this page needs work.' Use this even if the user just shares a URL and asks for feedback."
metadata:
  version: 2.0.0
---

# Conversion Rate Optimization (CRO)

This skill covers three funnel stages. Read the appropriate file based on the task:

## Mode Selection

| Funnel Stage | Task | File |
|---|---|---|
| **Page** | Optimize marketing pages (homepage, landing, pricing, feature) | [page.md](page.md) |
| **Signup** | Optimize signup, registration, or trial activation flows | [signup-flow.md](signup-flow.md) |
| **Onboarding** | Optimize post-signup activation and first-run experience | [onboarding.md](onboarding.md) |

## Shared Context

**Check for product marketing context first:**
If `.agents/product-marketing-context.md` exists (or `.claude/product-marketing-context.md` in older setups), read it before asking questions. Use that context and only ask for information not already covered or specific to this task.

## References

- [Page CRO Experiments](references/page-experiments.md) — A/B test ideas by page type
- [Onboarding Experiments](references/onboarding-experiments.md) — A/B test ideas for onboarding and activation
- For psychological principles, see [copywriting/references/psychology.md](../copywriting/references/psychology.md)
