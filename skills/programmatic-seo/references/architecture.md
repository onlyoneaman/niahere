# PSEO Architecture

## Core Principle

Separate concerns:

- Data layer decides what URLs exist.
- SEO core generates metadata, canonicals, robots directives, and schema.
- Templates render visible page content from structured data.
- Routing resolves canonical paths and page status.
- Linking builds the crawl graph.
- Sitemaps expose only canonical, indexable URLs.

## Canonical URL Registry

Use a single registry or query layer as the source of truth:

```txt
pseo_pages
- id
- canonical_path
- slug_parts
- template_key
- entity_ids or query_hash
- title
- meta_description
- h1
- status: draft | indexable | noindex | canonical_duplicate | redirected | deleted
- canonical_target
- redirect_target
- last_modified_at
- content_hash
- priority_bucket
```

Implementation rules:

- Page loaders fetch by canonical path.
- Missing or deleted pages return `404` or framework equivalent.
- `noindex` pages render explicit robots directives and stay out of sitemaps.
- Alias and legacy paths redirect to canonical paths.
- Internal links and sitemaps emit only canonical paths.

## Rendering Strategy

Choose rendering based on URL count, freshness, and cacheability:

- Full static generation: small, stable URL sets.
- ISR or equivalent incremental generation: large cacheable long-tail inventories.
- Dynamic rendering: real-time, personalized, auth-sensitive, or uncacheable pages.
- Static export: only when every route is known at build time and no incremental rendering is needed.

For Next.js-specific inspection and implementation guidance, read [nextjs-inspection.md](nextjs-inspection.md).

## Build Performance

Do:

- Pre-render only priority buckets when inventories are large.
- Generate fewer or zero long-tail paths in preview environments.
- Keep path collection cheap: one batched query, no full content fetches, no per-page network fanout.
- Fetch full content in the page loader, not in path generation.

Do not:

- Generate 100k+ pages in every build by default.
- Put expensive joins or remote calls inside path collection.
- Depend on dev-server behavior to validate production caching.

## Metadata And Schema Core

Create shared builders:

- `buildMetadata(page)`: title, description, canonical, robots, Open Graph, Twitter.
- `buildBreadcrumbs(page)`: canonical breadcrumb hierarchy.
- `buildSchema(page)`: JSON-LD matching visible content.
- `buildInternalLinks(page)`: parent, siblings, related pages, and next actions.

Schema rules:

- Use JSON-LD when possible.
- Mark up only content visible to users.
- Use the most specific relevant schema type.
- Keep required properties complete for the chosen rich result type.
- Validate representative pages with Rich Results Test or equivalent rendered inspection.

## Sitemaps

Rules:

- A sitemap file must stay under 50,000 URLs and 50MB uncompressed.
- Use a sitemap index for large inventories.
- Shard by page family, priority bucket, date, or deterministic ID range.
- Include only absolute canonical URLs returning 200 and marked indexable.
- Use accurate `lastmod` from the page source of truth.
- Reference the sitemap index from `robots.txt`.

For Next.js App Router, prefer `generateSitemaps()` or explicit route handlers for shards.

## Facets, Search Params, And Pagination

Facets are deny-by-default:

- Curate allowed indexable combinations.
- Return `404` for empty or nonsensical combinations.
- Use canonical or noindex for useful non-canonical variants.
- Avoid arbitrary sort, order, filter, and tracking parameters in crawlable links.

Pagination:

- Give paginated content unique crawlable URLs.
- Link pages with normal anchors.
- Self-canonicalize pages that are distinct paginated archives.
- Do not make infinite scroll or "load more" the only discovery path.
