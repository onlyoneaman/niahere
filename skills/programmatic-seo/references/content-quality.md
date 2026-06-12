# PSEO Content Quality

## Intent Gate

Approve a page family only when it has:

- A target user and job-to-be-done.
- One primary intent cluster, not a bag of keyword variants.
- One canonical URL per intent cluster.
- A distinct reason to exist: proprietary data, useful aggregation, comparison, local/entity specificity, workflow utility, first-hand expertise, or an interactive tool.
- A clear relationship to a hub, siblings, and downstream actions.

Reject pages created only for plural/singular variants, synonyms, "near me" swaps, city/service shells, or AI-query fanout.

## Page Entity Model

Each generated page should be a first-class entity with fields like:

```txt
id
canonical_path
template_key
intent
primary_keyword
supporting_keywords
parent_hub
related_pages
schema_type
status
last_modified_at
content_hash
quality_score
```

Keep page status explicit: `draft`, `indexable`, `noindex`, `canonical_duplicate`, `redirected`, or `deleted`.

## Unique Value Gate

Every indexable generated page should include at least 3-5 page-specific content blocks:

- Direct answer to the main query.
- Key facts table from structured data.
- Comparison, ranking, availability, pricing, or alternatives.
- Evidence, methodology, dates, and source attribution.
- Real FAQs from query data, support logs, or sales calls.
- Examples, workflows, screenshots, calculators, filters, or next-step actions.

The template can be repeated. The value inside it cannot be mostly boilerplate.

## Duplicate And Cannibalization Gate

Before indexation:

- Compare pages inside the same template family with shingles, hashes, embeddings, or another near-duplicate check.
- Check keyword-to-URL ownership: one owner URL per intent.
- Canonicalize, merge, redirect, noindex, or delete pages that satisfy the same intent.
- Avoid linking with the same anchor text to multiple competing pages.
- Publish in batches and monitor whether Google chooses unexpected canonicals.

## Doorway Risk Gate

Reject or redesign page sets where:

- Pages funnel users to one real page instead of solving the searcher's need.
- Many pages target similar queries with substantially similar content.
- Location/service pages only swap place names, numbers, or generic claims.
- Pages are internal search results with no curated value.
- Pages are discoverable only through XML sitemaps or SEO-only link blocks.
- The page family is closer to search results than to a browseable hierarchy.

## Hub And Spoke Linking

Use a deliberate graph:

- Hubs target broad topics, categories, use cases, locations, or entity classes.
- Spokes target narrower intents and link up to hubs.
- Spokes link sideways to true siblings and related alternatives.
- Hubs link down to high-quality spokes in useful groupings.
- Conversion links appear only when contextually useful.
- Links must be crawlable `<a href>` links to canonical URLs.

## Structured Blocks

Use blocks that are easy for users and search systems to parse:

- Definition or direct answer: 40-80 words.
- Step-by-step process for "how to" intent.
- Comparison table for "vs", "best", and evaluation intent.
- Pros/cons for decision intent.
- FAQ using natural questions.
- Evidence block with dated sources and methodology.

For AI-search extractability, prefer concise answer blocks, tables, current facts, named sources, and clear headings. Do not create thin pages for every AI fanout query.

## Kill, Merge, Or Improve Rules

Set a review window per page family. Then act:

- Merge if two pages earn impressions for the same intent.
- Canonicalize if variants are useful to users but not distinct search results.
- Noindex if a page is useful in-product but not a search landing page.
- Redirect or delete if it has no durable user value.
- Improve if it has impressions but weak click-through or engagement and the intent remains valid.
