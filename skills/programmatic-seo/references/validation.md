# PSEO Validation

## Pre-Launch Checklist

For each page family, verify:

- A clear target user, intent, and unique value source exists.
- Each indexable URL has a canonical path and status.
- Titles, H1s, descriptions, canonicals, robots directives, and schema are generated centrally.
- Content has page-specific data, not mostly boilerplate.
- Near-duplicate and cannibalization checks pass.
- Doorway-page risk has been explicitly reviewed.
- Internal links use crawlable anchors and canonical URLs.
- Breadcrumbs reflect the site hierarchy.
- Sitemaps include only canonical, indexable, 200-status URLs.
- Facets/search params cannot create infinite crawl spaces.
- Representative pages pass rendered metadata and schema inspection.

## Codebase Audit Checklist

Inspect:

- Route structure and dynamic SEO routes.
- URL source of truth: database, CMS, files, generated JSON, or ad hoc slug code.
- Page statuses and canonical/redirect/noindex handling.
- Metadata generation and duplicate title/description risks.
- JSON-LD generation and whether schema content is visible.
- Sitemap generation, shard size, absolute URLs, and `lastmod`.
- `robots.txt` sitemap references and disallow rules.
- Internal links to non-indexable, redirected, duplicate, or parameterized URLs.
- Build logs: static path counts, timeouts, remote API fanout, and preview behavior.
- Search/filter/facet/pagination URL behavior.

## Mechanical Tests

Add or run tests where practical:

- URL registry returns only valid indexable URLs for sitemap queries.
- Sitemap shards stay below URL and size limits.
- Non-indexable, deleted, duplicate, and redirected pages never appear in sitemaps.
- Metadata builder emits absolute canonicals.
- Schema builder omits invisible or unavailable content.
- Duplicate pages resolve through canonical/noindex/redirect behavior.
- Empty or invalid facet combinations return `404`.
- Preview builds do not pre-render the full long-tail inventory.

## Manual Spot Checks

Sample pages from every template and priority bucket:

- View rendered HTML head for title, description, canonical, robots, OG, Twitter, and JSON-LD.
- Confirm the canonical URL returns the same page and is linked internally.
- Confirm the page answers its primary intent without forcing a click to another page.
- Confirm visible page-specific facts match structured data.
- Confirm related links are useful and not just exact-match SEO blocks.

## Launch Strategy

- Publish in batches by page family or priority bucket.
- Submit sitemap indexes after the first batch is live.
- Watch Search Console for indexed count, discovered-not-indexed, crawled-not-indexed, duplicate without user-selected canonical, and unexpected canonical selection.
- Compare query-to-URL mapping after each batch.
- Delay the next batch if Google is ignoring, canonicalizing away, or clustering pages unexpectedly.

## Monitoring

Track:

- Indexed / submitted ratio by sitemap shard.
- Crawl stats and server errors.
- Unexpected canonical selection.
- Query cannibalization.
- Organic clicks, qualified conversions, and engagement by page family.
- Stale data and `lastmod` accuracy.
- Pages with impressions but poor CTR.
- Pages with no impressions after the review window.

Use monitoring to prune. More pages are not better if they dilute crawl demand, create cannibalization, or fail to serve users.
