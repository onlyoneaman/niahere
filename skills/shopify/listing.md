# Shopify App Store Listing Generator

Generate a `listing.md` file with copy-ready content for every field in the Shopify Partner Dashboard submission form.

**User request:** $ARGUMENTS

---

## How to Use This Skill

1. **Explore the codebase** to understand the app's features, pricing, and target audience
2. **Generate a `listing.md`** following the exact form structure below
3. **All copy in code blocks** so it's easy to copy-paste into the Partner Dashboard
4. **Include character counts** next to fields with limits
5. **No em dashes** in any copy - use regular dashes, commas, or periods instead
6. **Mark TODOs** for anything that needs manual action (assets, URLs, credentials)

---

## Partner Dashboard Form Structure

The listing.md must have these 8 numbered sections matching the submission form, plus a checklist:

### 1. Basic App Information
- **App name** (30 chars max, must start with brand name, must match shopify.app.toml)
- **App icon** (1200x1200px, JPG/PNG, no text, no seasonal promotions, must match app setup icon)
- **App category** - primary and secondary from the official list (see Categories Reference below)
  - Include "Why" rationale for each choice (categories cannot be changed after submission without appeal)
- **Languages** - only list languages where the full merchant UI is available

### 2. App Store Listing Content
- **App introduction** (100 chars max) - two brief sentences: purpose + main benefit
  - No unnecessary keywords, no generic marketing language
- **App details** (500 chars max) - explain how the app solves problems
  - Full sentences, clear and concise
  - No links, URLs, or text formatting
  - No jargon, testimonials, statistics, or unverifiable claims
- **Features** (3-5 features, 80 chars each) - high-level capability descriptions
  - Focus on unique differentiators
  - Plain readable language, not marketing speak
- **Demo store URL** (255 chars, optional) - link to relevant part of a demo store
- **Feature media** - video (preferred, max 3 min) or image, 1600x900px
  - Video thumbnail also 1600x900px
  - No Shopify logo, no heavy text
- **Screenshots** - 3-6 desktop at 1600x900px
  - Alt text for each (64 chars max)
  - No browser chrome, desktop backgrounds, PII, or Shopify logos
  - Mobile and POS screenshots optional
- **Integrations** (optional, max 6, 30 chars each) - do NOT include "Shopify"
- **Support** - preferred channel, email, portal URL, phone (optional)
- **Resources** - privacy policy URL (required), developer website, FAQ, changelog, tutorial, additional docs (all optional)

### 3. Pricing Details
- Display name and top features for each public plan
- Pricing info URL (optional)
- Plans sync from Shopify Billing API automatically

### 4. App Discovery Content
- **App card subtitle** (62 chars max) - summarize app and unique benefits as a sentence
  - No generic marketing language, no keyword stuffing
- **Search terms** (1-5 terms, 20 chars each) - complete words only
  - No "Shopify", no competitor names, one idea per term
- **Web search content** (optional SEO)
  - Title tag (60 chars max)
  - Meta description (160 chars max)

### 5. Install Requirements
- **Sales channel requirements** - check Online Store if app includes theme extensions
- **Geographic requirements** (optional) - country/region/currency restrictions

### 6. Tracking Information
- Google Analytics (Measurement ID + API Secret)
- Google Remarketing (Conversion ID)
- Facebook Pixel (Pixel ID + Access Token)

### 7. Contact Information
- **Merchant review email** - notified when merchants review the app
- **App submission email** - Shopify communicates during review at this address
  - Whitelist: app-submissions@shopify.com and noreply@shopify.com

### 8. App Testing Information
- **Test account** - login credentials for full end-to-end access (no Google SSO, no 2FA unless unavoidable)
  - Or check "My app doesn't require an account" if it uses Shopify OAuth only
- **Screencast URL** (255 chars) - 3-8 min video demo showing onboarding + core features + merchant + customer flows
- **Testing instructions** (2800 chars max) - step-by-step bullet points, concise and clear

### Submission Checklist
Group into: Content ready, Visual assets ready, Pricing/support ready, Technical ready, Testing ready.

---

## Categories Reference

Official Shopify app categories, subcategories, and tags:

### Sales channels
- Selling online: Marketplaces, Product feeds, Store data importer, Selling online - Other
- Selling in person: Retail, Store locator, SKU and barcodes, Selling in person - Other

### Finding products
- Sourcing options: Dropshipping, Print on demand (POD), Wholesale, Sourcing options - Other
- Digital goods and services: Digital products, NFTs and tokengating, Event booking, Digital goods and services - Other

### Selling products
- Payment options: Subscriptions, Payments, Cash on delivery (COD), Payment options - Other
- Pricing: Pricing optimization, Pricing quotes, Pricing - Other
- Custom products: Product variants, Custom file upload, Custom products - Other

### Store design
- Storefronts: Page builder, Mobile app builder, Storefronts - Other
- Site optimization: SEO, Accessibility, Site optimization - Other
- Search and navigation: Search and filters, Navigation and menus, Search and navigation - Other
- Images and media: Image gallery, Image editor, Video and livestream, 3D/AR/VR, Images and media - Other
- Design elements: Animation and effects, Badges and icons, Design elements - Other
- Notifications: Banners, Pop-ups, Forms, Notifications - Other
- Content: Metafields, Product content, Blogs, Content - Other
- Product display: Product comparison, Collections, Product display - Other
- Internationalization: Currency and translation, Geolocation, Cookie consent, Internationalization - Other

### Orders and shipping
- Orders: Order tracking, Order editing, Invoices and receipts, Orders - Other
- Shipping solutions: Shipping, Shipping rates, Third-party logistics (3PL), Delivery and pickup, Shipping solutions - Other
- Inventory: Inventory sync, Inventory optimization, ERP, Inventory - Other
- Returns and warranty: Returns and exchanges, Warranties and insurance, Returns and warranty - Other

### Marketing and conversion
- Advertising: Ads, Affiliate programs, Advertising - Other
- Marketing: Email marketing, SMS marketing, Web push, Abandoned cart, Marketing - Other
- Checkout: Cart customization, Order limits, Checkout - Other
- Promotions: Discounts, Giveaways and contests, Promotions - Other
- Gifts: Gift cards, Gift wrap and messages, Gifts - Other
- Upsell and bundles: Product bundles, Upsell and cross-sell, Countdown timer, Stock alerts, Pre-orders, Upsell and bundles - Other
- Social trust: Product reviews, Social proof, Social trust - Other
- Customer loyalty: Loyalty and rewards, Wishlists, Donations, Customer loyalty - Other

### Store management
- Operations: Workflow automation, Bulk editor, Staff notifications, Analytics, Operations - Other
- Security: Legal, Fraud, Anti theft, Accounts and login, Security - Other
- Finances: Accounting, Taxes, Finances - Other
- Support: Chat, Helpdesk, FAQ, Surveys, Support - Other

---

## Content Rules

1. **No em dashes** - use regular dashes, commas, or periods
2. **No Shopify trademarks** in visual assets (icon, screenshots, feature media)
3. **No pricing info** in screenshots or icon
4. **No links/URLs** in app details text
5. **No statistics, testimonials, or unverifiable claims** in listing copy
6. **Provide alternates** for introduction, subtitle, and other short-form fields
7. **Include character counts** for all fields with limits
8. **Mark [TODO]** for items requiring manual action

---

## Review Tips

- Categories cannot be changed after submission without an appeal - choose carefully
- The screencast is critical for approval - show complete merchant and customer flows
- Review timeline: 4-7 business days initial, 2-4 weeks if revisions needed
- Listing is editable after approval - prioritize getting submitted over perfection
- Whitelist Shopify emails before submitting to avoid missing review feedback
