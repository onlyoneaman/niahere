# Shopify App Builder Reference (2026)

Comprehensive guide based on current Shopify docs, ecosystem research, and best practices as of February 2026.

**User request:** $ARGUMENTS

---

## 1. Tech Stack (Current Recommended)

### Framework: Remix (Official)
- Shopify owns Remix — it's the officially recommended framework
- Package: `@shopify/shopify-app-remix` (auth, billing, webhooks, session tokens)
- Template: `shopify/shopify-app-template-remix` on GitHub
- Scaffold: `shopify app init` via Shopify CLI
- `@shopify/shopify-app-react-router` is the newer recommended path (Remix → React Router migration)

### UI: Polaris Web Components (NOT React)
- **CRITICAL: `@shopify/polaris` React is DEPRECATED and archived as of January 6, 2026**
- New Polaris is built on Web Components, loads from Shopify's CDN
- Works with any framework or none — significantly smaller and faster
- Components auto-update without code changes
- Unified across Admin, Checkout, and Customer Accounts
- Docs: shopify.dev/docs/api/pos-ui-extensions/2026-01-rc/polaris-web-components

### API: GraphQL Admin API (Required)
- **REST Admin API is legacy as of October 1, 2024**
- All new public apps MUST use GraphQL Admin API exclusively (enforced April 1, 2025)
- Latest stable version: 2026-01
- Key feature (2026-01): Idempotency keys on refund and inventory mutations

### Database
- **Prisma + PostgreSQL** is the standard pairing
- Prisma handles migrations, type safety, and schema management
- SQLite for dev is fine but use PostgreSQL from day 1 for production

### Background Jobs
- **BullMQ + Redis** for job queues, timers, retry logic
- Good for: scheduled tasks, webhook processing, delayed operations

### CLI
- Shopify CLI (latest) — scaffolding, dev server, extension dev, deployment
- `shopify app dev` for local development with hot reload
- `shopify app deploy` for pushing extensions

### Dev vs Prod App Config (Best Practice)
- Keep separate app config files for each environment:
  - `shopify.app.toml` for development
  - `shopify.app.production.toml` for production deploy
- In development config:
  - set `[build].automatically_update_urls_on_dev = true`
  - run `shopify app dev --config shopify.app.toml`
- In production config:
  - set `[build].automatically_update_urls_on_dev = false`
  - run `shopify app deploy --config shopify.app.production.toml`
- Use config switching/linking explicitly:
  - `shopify app config use shopify.app.toml`
  - `shopify app config use shopify.app.production.toml`
  - `shopify app config link --client-id <your-client-id>` for non-interactive linking
- Keep extension runtime URLs environment-aware (`EXTENSION_API_BASE_URL_DEV` for tunnel/dev and `EXTENSION_API_BASE_URL` for prod) and avoid hardcoding production hostnames in local `.env`.

---

## 2. Authentication & Sessions

### Embedded Apps (Standard)
- All modern Shopify apps should be embedded (renders inside Shopify Admin)
- Configuration in `shopify.web.toml`
- Third-party cookies don't work in embedded context — use session tokens

### Session Token Auth
- App Bridge automatically adds session tokens to requests via `authenticatedFetch`
- Token lifetime: 1 minute (must be fetched fresh per request)
- Token exchange pattern: session token → exchange for online/offline access tokens
- `@shopify/shopify-app-remix` handles this automatically

### OAuth Flow
- Handled by the Remix package — you rarely touch this directly
- Offline tokens for background jobs (webhooks, crons)
- Online tokens for user-specific admin actions

---

## 3. Extensions (Know Which to Use)

### Customer Account UI Extensions
- **Use for:** Order status page, account page, profile page
- Target: `customer-account.order-status.block.render` (block on order status)
- Target: `customer-account.order-status.payment-details.render-after` (after payment details)
- Pre-authenticated — seamless customer login
- Scaffolded with Preact by default
- Use `OrderStatusApi` to get order details (id, name, confirmation number)
- Docs: shopify.dev/docs/api/customer-account-ui-extensions/latest

### Theme App Extensions
- **Use for:** Online store surfaces (thank-you page, product pages, cart)
- Required for App Store listing — Shopify mandates theme app extensions for new apps
- Merchants enable via theme editor (no code changes)
- App blocks that merchants can add/modify/remove
- Liquid + JS implementation

### Admin UI Extensions
- **Use for:** Adding functionality to Shopify Admin pages
- Product pages, order pages, customer pages
- Render using Shopify's native UI components

### Checkout UI Extensions
- **Use for:** Customizing checkout flow
- Requires Shopify Plus or specific plan access

### When to use what:
| Surface | Extension Type |
|---------|---------------|
| Order status page (customer) | Customer Account UI Extension |
| Thank-you page | Theme App Extension (app block) |
| Product page widget | Theme App Extension (app block) |
| Admin order page | Admin UI Extension |
| Checkout | Checkout UI Extension |
| Entire admin panel | Embedded App (Remix routes) |

---

## 4. Webhooks

### Setup
- Register via `shopify.app.toml` or programmatically
- Shopify delivers HTTP POST to your endpoint
- Headers contain shop domain, event type, HMAC signature
- **Always verify HMAC** before processing
- Payload in JSON

### Common Webhook Topics
```
orders/create        — New order placed
orders/updated       — Order modified
orders/paid          — Payment completed
orders/fulfilled     — Order fulfilled
orders/cancelled     — Order cancelled
refunds/create       — Refund issued
customers/create     — New customer
customers/update     — Customer modified
app/uninstalled      — App removed (cleanup!)
products/create      — New product
products/update      — Product modified
inventory_levels/update — Stock changed
```

### Best Practices
- Make handlers idempotent (webhooks can be delivered multiple times)
- Process async (queue the work, respond 200 immediately)
- Implement reconciliation jobs for missed webhooks
- Subscribe to `app/uninstalled` — clean up shop data

---

## 5. Key GraphQL Mutations & Queries

### Order Management
```graphql
# Cancel an order
orderCancel(orderId: ID!, reason: OrderCancelReason!, refund: Boolean!, restock: Boolean!)

# Edit an order (begin → edit → commit pattern)
orderEditBegin(id: ID!)
orderEditAddCustomItem(...)
orderEditCommit(id: ID!)

# Tag management
tagsAdd(id: ID!, tags: [String!]!)
tagsRemove(id: ID!, tags: [String!]!)
```

### Fulfillment Management
```graphql
# Hold fulfillment
fulfillmentOrderHold(id: ID!, fulfillmentHold: { reason: String!, reasonNotes: String })

# Release hold
fulfillmentOrderReleaseHold(id: ID!)

# Cancel fulfillment order
fulfillmentOrderCancel(id: ID!)
```

### Billing
```graphql
# Create subscription
appSubscriptionCreate(name: String!, lineItems: [...], returnUrl: URL!)

# Create usage charge (on top of subscription)
appUsageRecordCreate(subscriptionLineItemId: ID!, price: MoneyInput!, description: String!)
```

---

## 6. Shopify Flow Integration

### How Apps Integrate with Flow
- Apps can provide **triggers** (events that start a Flow) and **actions** (things Flow can tell your app to do)
- Define in app configuration
- Properties are passed to Flow for use in conditions/actions

### Flow Availability
- Available on Basic, Grow, Advanced, and Plus plans (free)
- "Send HTTP Request" action only on Grow, Advanced, Plus
- Sidekick (AI) can generate workflows using app triggers/actions

### Implementation
- Define triggers in your app's Flow configuration
- Fire triggers via Shopify API when events occur in your app
- Merchants build automations using your triggers in the Flow editor

---

## 7. Billing API

### Pricing Models
- **Recurring subscription:** Fixed monthly/annual charge
- **Usage-based:** Metered charges on top of subscription (Every30Days interval)
- **Managed pricing:** Simple fixed recurring (currently no usage-based support)
- **One-time charges:** Single purchase

### Best Practices
- Simple pricing plans convert better (~75% of top apps use subscription only)
- 3 tiers is the sweet spot (Free / Basic / Pro)
- Generous free tier is essential for review acquisition
- 7-day free trial on paid tiers
- Usage tracking for free tier enforcement

### Key Webhooks
- `APP_SUBSCRIPTIONS_APPROACHING_CAPPED_AMOUNT` — merchant at 90% of usage cap
- `APP_SUBSCRIPTIONS_UPDATE` — subscription status changed

### Pricing Strategy Data
- Apps under $10/mo: 6.2% monthly churn (lowest)
- Apps $25-50/mo: 8.7% monthly churn (highest)
- Only ~13% of installs convert free → paid
- Average LTV of paid user: ~$300
- Most successful apps: 3-6 months to first $1,000 MRR

---

## 8. App Store Optimization (ASO)

### Ranking Factors (by importance)
1. **Average rating** — most influential
2. **Number of downloads** — strong signal
3. **Number of reviews** — social proof + ranking
4. **Keyword usage** — the only factor you control without ranking first

### App Name & Subtitle
- App name: max 30 characters — include primary keyword
- Subtitle: max 62 characters — include secondary keywords
- These are the first impression and most important for ranking

### Description
- First 2 lines visible in search results — make them count (pain point hook)
- Integrate keywords naturally (no stuffing)
- Structure: pain → solution → features → social proof → setup ease

### Visual Assets
- Screenshots: show value, not just features. Annotated images.
- Refresh screenshots every 4-8 weeks
- Add ALT text with keywords for SEO
- Video: 90-120 seconds, promotional not instructional, limit screencasts to 25%

### Review Acquisition
- Launch with free tier — accumulate 20+ reviews before monetizing aggressively
- In-app prompt after demonstrated value (e.g., 5th successful action)
- Respond to ALL reviews within 24 hours
- Target: 20+ reviews in 60 days, 50+ by month 4
- Introduce billing by month 3 at latest

### Built for Shopify Badge
Requirements:
- Minimum 50 net installs from active shops on paid Shopify plans
- Minimum 5 reviews
- Minimum recent app rating threshold
- No storefront speed impact > 10 performance points
- Reviewed annually for compliance
- Timeline target: Apply by month 3-4

### Continuous Optimization
- Review ranking, installs, conversion rate weekly
- A/B test listing elements (title, screenshots, icon) one at a time, 7-14 days each
- Update keywords and visuals when performance drops

---

## 9. Competitive Research Checklist

When entering a Shopify app category:

1. **Search the App Store** for your primary keywords — note top 5 apps
2. **Record for each:** name, rating, review count, pricing, key features
3. **Read negative reviews** (1-2 star) — these reveal gaps and pain points
4. **Identify table stakes** — features every app has (must-have for parity)
5. **Identify differentiators** — what no one does well or at all
6. **Price positioning** — undercut the leader slightly on basic tier, justify premium on advanced
7. **Check "Built for Shopify" status** — badged apps have higher trust

---

## 10. Common Architecture Patterns

### Webhook → Queue → Process
```
Shopify webhook → Your endpoint (respond 200 immediately)
                → Queue job in BullMQ/Redis
                → Worker processes job async
                → Calls Shopify API as needed
```

### Extension → API → Shopify
```
Customer/Theme Extension → fetch() to your app's API
                         → Validate session/auth
                         → Business logic
                         → Call Shopify GraphQL API
                         → Return result to extension
```

### Scheduled Jobs
```
BullMQ repeatable job → Check DB for pending work
                      → Process batch
                      → Update DB + call Shopify API
Good for: timer expiry, reconciliation, analytics aggregation
```

---

## 11. Deployment on DigitalOcean

### Standard Setup
- **App:** Node.js (Remix) via PM2 or Docker
- **Database:** PostgreSQL on the VM
- **Redis:** On the VM (for BullMQ)
- **Reverse proxy:** Nginx + Let's Encrypt SSL
- **CI/CD:** GitHub Actions → SSH deploy

### Setup Scripts
```bash
# One-time DB setup
sudo -u postgres psql -c "CREATE USER myapp WITH PASSWORD 'pass';"
sudo -u postgres psql -c "CREATE DATABASE myapp OWNER myapp;"

# Prisma workflow
npx prisma migrate dev --name init     # Dev: create migration
npx prisma migrate deploy              # Prod: apply migrations
npx prisma generate                    # Regenerate client after schema changes
npx prisma studio                      # Visual DB browser (dev)

# Deploy script
cd /var/www/myapp && git pull origin main
npm ci --production=false
npx prisma migrate deploy
npm run build
pm2 restart myapp
```

### Nginx Config Pattern
```nginx
server {
    listen 443 ssl;
    server_name myapp.example.com;

    ssl_certificate /etc/letsencrypt/live/myapp.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/myapp.example.com/privkey.pem;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

---

## 12. Security Checklist

- [ ] Verify HMAC on all webhooks
- [ ] Validate session tokens on all API routes
- [ ] Use CSRF protection on forms
- [ ] Sanitize all user input
- [ ] Rate limit API endpoints
- [ ] Don't expose access tokens to client
- [ ] Use parameterized queries (Prisma handles this)
- [ ] Set appropriate CORS headers
- [ ] Store secrets in environment variables, never in code

---

## 13. Official Documentation (LLM-Optimized)

**Always fetch https://shopify.dev/llms.txt first** when researching Shopify docs — it's Shopify's official LLM-friendly reference with current URLs and context.

### Core Documentation
- App config: https://shopify.dev/docs/apps/build/cli-for-apps/app-configuration
- GraphQL Admin API: https://shopify.dev/docs/api/admin-graphql
- GraphQL best practices: https://shopify.dev/docs/apps/build/graphql
- Access scopes: https://shopify.dev/api/usage/access-scopes
- Auth & sessions: https://shopify.dev/docs/apps/build/authentication-authorization
- Webhooks (toml config): https://shopify.dev/docs/api/webhooks?reference=toml
- Custom data (metafields/metaobjects): https://shopify.dev/docs/apps/build/custom-data

### CLI
- CLI reference: https://shopify.dev/docs/api/shopify-cli
- CLI app commands: https://shopify.dev/docs/api/shopify-cli/app
- CLI theme commands: https://shopify.dev/docs/api/shopify-cli/theme

### UI & Components
- Polaris Web Components: https://shopify.dev/docs/api/app-home/polaris-web-components
- Polaris CDN: https://cdn.shopify.com/shopifycloud/polaris.js
- Polaris docs site: https://polaris.shopify.com/
- React Router template: https://github.com/Shopify/shopify-app-template-react-router

### Extensions
- Checkout UI Extensions: https://shopify.dev/docs/api/checkout-ui-extensions
- Checkout targets: https://shopify.dev/docs/api/checkout-ui-extensions/2025-01/extension-targets-overview
- Checkout components: https://shopify.dev/docs/api/checkout-ui-extensions/2025-01/components
- Admin Extensions: https://shopify.dev/docs/api/admin-extensions
- Customer Account Extensions: https://shopify.dev/docs/api/customer-account-ui-extensions
- Customer Account targets: https://shopify.dev/docs/api/customer-account-ui-extensions/2025-01/extension-targets-overview
- Theme App Extensions: https://shopify.dev/docs/apps/build/online-store/theme-app-extensions
- POS UI Extensions: https://shopify.dev/docs/api/pos-ui-extensions
- UI Extensions source: https://github.com/Shopify/ui-extensions/blob/unstable/packages/ui-extensions
- UI Extensions React source: https://github.com/Shopify/ui-extensions/blob/unstable/packages/ui-extensions-react

### Storefront & Themes
- Storefront API: https://shopify.dev/docs/api/storefront
- Liquid reference: https://shopify.dev/docs/api/liquid
- Liquid objects: https://shopify.dev/docs/api/liquid/objects
- Liquid tags: https://shopify.dev/docs/api/liquid/tags
- Liquid filters: https://shopify.dev/docs/api/liquid/filters
- Hydrogen: https://shopify.dev/docs/api/hydrogen
- Hydrogen getting started: https://shopify.dev/docs/storefronts/headless/hydrogen/getting-started

### Launch & Growth
- Built for Shopify: https://shopify.dev/docs/apps/launch/built-for-shopify
- Accessibility: https://shopify.dev/docs/apps/build/accessibility

---

## 14. Common Pitfalls

| Pitfall | Fix |
|---------|-----|
| Using Polaris React | It's deprecated. Use Polaris Web Components. |
| Using REST Admin API | Legacy. Use GraphQL exclusively. |
| Not verifying webhook HMAC | Security vulnerability. Always verify. |
| Synchronous webhook processing | Respond 200 immediately, process async via queue. |
| No reconciliation for missed webhooks | Add a cron job to catch up on missed events. |
| Ignoring payment state on refunds | Void authorizations when possible to save merchant fees. |
| Launching paid-only | Free tier is essential for building review momentum. |
| Theme app extension for order status | Use Customer Account UI Extension instead. |
| Not handling `app/uninstalled` webhook | Clean up shop data and cancel pending jobs. |
| Hardcoding API version | Pin to a specific version, update deliberately. |
| Not using idempotency keys | 2026-01 supports them on mutations — use for safety. |

---

## 15. Production Learnings (Generic Shopify)

Practical patterns that apply across most Shopify apps.

### Source of Truth
- Prefer Shopify platform state (orders, fulfillment, tags, payment state) as the source of truth for business decisions.
- Minimize duplicated internal state; when persistence is needed, store outcomes/events and derive status from platform + config.

### Metrics and Day Bucketing
- Store shop-level timezone and use it consistently for daily metric writes and reads.
- Keep one shared day-key utility for aggregation + dashboard rendering to avoid date drift.
- Treat timezone fallback (`UTC`) as explicit behavior, not accidental behavior.

### Extension Runtime Hygiene
- Explicitly declare required extension capabilities (for example network access) before shipping any `fetch()` behavior.
- Keep dev/prod endpoint handling deterministic and generated from environment values to avoid stale runtime config.
- For tunnel-based development, align host allowlists/proxy settings with local tooling.

### UX Resilience
- Enforce eligibility client-side for time-sensitive actions (for example countdown expiry) in addition to server checks.
- Close or disable stale UI states when underlying eligibility changes mid-interaction.
- Always provide user-safe fallback messaging for network and platform failures.

### API and Error Handling
- Design public endpoints to be idempotent where possible.
- Return clear, action-oriented operator errors for infra/config issues (for example missing migrations), while keeping user-facing errors simple.
- Log structured debug context in development; avoid leaking internals in production responses.

### Plan and Feature Gating
- Centralize plan limits and feature flags in one server-side module.
- Apply the same gating logic consistently across API responses, extension payloads, and admin UI.
- Enforce limits server-side; UI gating is only a convenience layer.

### Webhooks and Consistency
- Make webhook handlers idempotent and resilient to retries/out-of-order delivery.
- Queue heavy processing and respond quickly to Shopify.
- Add periodic reconciliation jobs for eventual consistency.

### Deploy and Migrations
- Make migrations part of deploy, not a manual afterthought.
- Keep environment-specific DB URLs explicit and scriptable for dev/staging/prod.
- Add lightweight operational scripts for plan/testing toggles and support debugging.
