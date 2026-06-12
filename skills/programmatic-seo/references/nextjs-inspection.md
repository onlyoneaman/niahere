# Next.js PSEO Inspection

Use this when auditing or optimizing a Next.js app for programmatic SEO. Keep the inspection tied to the app's actual version, router, deployment target, and caching model.

## Quick Classification

Inspect first:

- Next.js version and whether the app uses App Router, Pages Router, or both.
- Deployment target: Vercel, self-hosted Node, static export, edge runtime, or other.
- `next.config.*` for `output: "export"`, redirects, rewrites, headers, image config, experimental cache settings, and trailing slash behavior.
- Route inventory: `app/`, `pages/`, route handlers, dynamic segments, catch-all routes, and sitemap/robots files.
- Data source for slugs, canonical paths, status, redirects, `lastmod`, and template selection.

## App Router Checks

Inspect dynamic SEO routes:

- `app/[slug]/page.tsx`, `app/[...slug]/page.tsx`, or template-specific dynamic routes.
- `generateStaticParams()` scope and cost.
- `dynamicParams`, `dynamic`, `revalidate`, `fetchCache`, and runtime exports.
- `generateMetadata()` and whether it uses the same canonical registry as page rendering.
- `notFound()`, redirects, and `robots` metadata for non-indexable states.

Default for large PSEO: pre-render only priority paths and let the long tail generate through ISR or cached request-time rendering.

Pattern:

```ts
export const revalidate = 3600

export async function generateStaticParams() {
  return hotPaths.map((path) => ({ slug: path.split("/") }))
}
```

Rules:

- `generateStaticParams()` should fetch paths only, not full page bodies.
- Do not run one DB/API request per generated URL.
- Do not pre-render every long-tail URL in preview builds.
- Validate ISR/caching in production mode, not only `next dev`.

## Pages Router Checks

Inspect:

- `getStaticPaths`, `fallback`, `getStaticProps`, `revalidate`, and `getServerSideProps`.
- Whether `getStaticPaths` returns all URLs or only priority URLs.
- Whether fallback pages render complete indexable content once generated.
- Whether page data is too large for hydration or `__NEXT_DATA__`.

Prefer `fallback: "blocking"` or an equivalent long-tail strategy for large inventories when using Pages Router, unless the app has a reason to prebuild all paths.

## Metadata And Canonicals

Check that metadata is centralized:

- Title, description, canonical, robots, Open Graph, and Twitter values come from the page registry or SEO core.
- Canonicals are absolute, stable, and match internal links and sitemap URLs.
- Non-indexable statuses emit `noindex` and stay out of sitemaps.
- Duplicate or alias paths redirect or canonicalize consistently.
- `generateMetadata()` does not duplicate expensive page loading if the page also fetches the same data.

## Structured Data

Inspect JSON-LD generation:

- It is emitted server-side in rendered HTML.
- It describes visible content on the page.
- It uses the right type for the template: `Article`, `FAQPage`, `BreadcrumbList`, `Product`, `ItemList`, `LocalBusiness`, or another specific type.
- Breadcrumb schema matches visible breadcrumbs and canonical URLs.
- FAQ schema only marks up visible FAQs.

## Sitemaps And Robots

Inspect:

- `app/sitemap.ts`, nested `sitemap.ts`, route handlers, or generated XML files.
- `generateSitemaps()` if URL count exceeds one sitemap file.
- URL count per shard and uncompressed size.
- Absolute canonical URLs only.
- Accurate `lastModified` from source data.
- No `noindex`, redirect, duplicate, 404, draft, or parameter URLs.
- `app/robots.ts` or `public/robots.txt` references the sitemap index.

For large inventories, shard by template, priority bucket, updated date, or deterministic ID range.

## Links, Facets, And Pagination

Inspect rendered links:

- Hubs, breadcrumbs, related pages, siblings, and next actions use normal `<a href>` links.
- Internal links point to canonical URLs.
- Search/filter/sort params are not crawlable by default.
- Empty or nonsensical facet combinations return `404` or are blocked before indexation.
- Paginated archives have unique crawlable URLs and self-canonicals when they represent distinct pages.

## Build And Runtime Performance

Inspect build output and logs:

- Number of generated static pages.
- Time spent inside path generation.
- Remote API or DB fanout during build.
- Static generation timeout warnings.
- Preview build behavior versus production build behavior.
- Cache invalidation strategy: `revalidatePath`, `revalidateTag`, cache tags, or deploy-based rebuilds.
- Self-hosted deployments: whether ISR/cache storage is shared across instances.

Recommended guardrails:

- Cap pre-rendered PSEO paths by environment.
- Make path generation a single batched query.
- Cache shared template data separately from per-page data.
- Use on-demand revalidation for CMS or data updates where available.
- Add tests that sitemap queries exclude non-indexable statuses.

## Output For A Next.js PSEO Audit

Return:

- `Router and rendering`: current setup and scaling risk.
- `URL source of truth`: where canonical path/status data lives.
- `Metadata/schema`: centralization and correctness gaps.
- `Sitemaps/robots`: shard and inclusion issues.
- `Crawl graph`: internal link and facet risks.
- `Build/runtime`: slow-build and cache risks.
- `Fix plan`: smallest code changes and verification commands.
