# Melch.Cloud -- Complete Project Context for Autonomous Agent

> This document contains everything an autonomous AI agent needs to understand and contribute to the Melch.Cloud codebase. Written June 2026.

---

## 1. Project Overview

**Melch.Cloud** is a multi-brand DTC (direct-to-consumer) marketing command center built by Melch Media (google@melch.media). It serves media buying teams who manage paid advertising for DTC brands -- primarily beauty/skincare companies.

**Core functions:**
- **Creative pipeline**: Upload ad creatives (images/videos), organize into batches, track them through a status pipeline (pending -> in_review -> approved -> scheduled -> live -> paused -> killed), and sync files to Dropbox
- **Daily P&L dashboard**: Shopify order data + Meta/Google ad spend synced daily, showing revenue, ROAS, MER, contribution margin, NC/RC splits
- **Meta Ads analytics**: Creative performance, copy analysis, campaign metrics, ad changelog, landing page attribution
- **Client self-service**: Brand founders/strategists can log in to view their own brand's data

**Active brands** (as of June 2026):
- **Tallow Twins** (tallowtwins.myshopify.com) -- primary client, fully connected (Shopify, Meta act_736883766717486, Google 6996956911)
- **MTE (More Than Essentials)** -- brand exists but Shopify connection NOT set up yet (no credentials configured)
- **FOND**, **Organic Jaguar**, **Nimi Skincare** -- other brands in various stages
- **Seven Weeks** -- archived (soft-deleted via archived_at column)

**Users:**
- **Admin** (role: 'admin') -- Melch Media team, full access to everything
- **Strategist** (role: 'strategist') -- media buyers assigned to specific brands
- **Founder** (role: 'founder') -- brand owners, can view their own brand's P&L and upload creatives
- **User** (role: 'user') -- basic role from original schema, largely superseded by strategist/founder

**Production URL:** https://melch.cloud
**Supabase project ID:** txetdixzcftzetqiuzan

---

## 2. Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Framework | Next.js (App Router) | 14.2.35 |
| React | React | ^18 |
| Language | TypeScript | ^5 |
| CSS | Tailwind CSS | ^3.4.1 |
| Database | Supabase (Postgres) | @supabase/supabase-js ^2.101.1 |
| Auth | Supabase Auth | @supabase/ssr ^0.10.0 |
| Hosting | Vercel | |
| Blob Storage | Vercel Blob | @vercel/blob ^2.3.3 |
| Background Jobs | Inngest | ^3.54.0 |
| Cache/Rate Limit | Upstash Redis | @upstash/redis ^1.37.0, @upstash/ratelimit ^2.0.8 |
| Email | Resend | ^6.10.0 |
| Charts | Recharts | ^3.8.1 |
| Icons | Lucide React | ^1.7.0 |
| Error Tracking | Sentry | @sentry/nextjs ^10.47.0 |
| Analytics | PostHog | posthog-js ^1.364.7, posthog-node ^5.28.11 |
| ZIP | JSZip | ^3.10.1 |
| Google APIs | googleapis | ^144.0.0 |
| AI | Anthropic SDK | @anthropic-ai/sdk ^0.82.0 |
| Speed | Vercel Speed Insights | @vercel/speed-insights ^2.0.0 |

**Design system:**
- Dark theme: background `#0a0a0a`, text `#f5f5f8`, accent gold `#c8b89a`
- Font: Satoshi (primary), Inter (fallback)
- All custom colors under `brand.*` in Tailwind config

---

## 3. Directory Structure

```
/
├── src/
│   ├── app/                          # Next.js App Router pages + API routes
│   │   ├── page.tsx                  # Login page (root /)
│   │   ├── layout.tsx                # Root layout (PostHog, SpeedInsights)
│   │   ├── dashboard/page.tsx        # Main dashboard
│   │   ├── upload/page.tsx           # Creative upload form
│   │   ├── submissions/page.tsx      # Submissions list / pipeline view
│   │   ├── stats/page.tsx            # File tracker stats
│   │   ├── releases/page.tsx         # Release notes
│   │   ├── team/page.tsx             # Team management
│   │   ├── account/page.tsx          # User account settings
│   │   ├── calendar/page.tsx         # Marketing calendar
│   │   ├── ad-changelog/page.tsx     # Ad status changes
│   │   ├── ad-lab/page.tsx           # Ad lab / testing
│   │   ├── book-a-call/page.tsx      # Booking page
│   │   ├── change-log/page.tsx       # App changelog
│   │   ├── copy-templates/page.tsx   # Copy template library
│   │   ├── feature-requests/page.tsx # Feature request board
│   │   ├── privacy/page.tsx          # Privacy policy
│   │   ├── app/                      # Shopify embedded app
│   │   │   ├── page.tsx              # Embedded app entry
│   │   │   └── EmbeddedBootstrap.tsx # Shopify App Bridge bootstrap
│   │   ├── admin/
│   │   │   ├── page.tsx              # Admin panel
│   │   │   ├── dropbox/page.tsx      # Dropbox connection management
│   │   │   └── onboard/page.tsx      # Client onboarding wizard
│   │   ├── analytics/
│   │   │   ├── page.tsx              # Analytics hub
│   │   │   ├── ad-perspective/       # Ad performance perspective table
│   │   │   ├── campaigns/            # Campaign metrics
│   │   │   ├── copy-analysis/        # Copy text analysis
│   │   │   ├── creative-matrix/      # Creative diversity matrix
│   │   │   ├── daily-pnl/            # Daily P&L view
│   │   │   ├── efficiency/           # Marginal efficiency curve
│   │   │   ├── forecast/             # 12-month forecast
│   │   │   ├── landing-pages/        # Landing page attribution
│   │   │   └── ltv-cohorts/          # LTV cohort analysis
│   │   └── api/                      # API routes (see section 5)
│   ├── components/
│   │   ├── DataFreshness.tsx         # Shows data staleness indicator
│   │   ├── FileCard.tsx              # Individual file card in upload form
│   │   ├── FileTracker.tsx           # File pipeline tracker component
│   │   ├── FileUploader.tsx          # Drag-and-drop file uploader
│   │   ├── Navbar.tsx                # Main navigation sidebar
│   │   ├── PostHogProvider.tsx       # PostHog analytics wrapper
│   │   ├── StatusBadge.tsx           # Status pill component
│   │   └── SubmissionForm.tsx        # Main upload form (large, ~47KB)
│   ├── audits/                       # Page audit documents
│   └── lib/
│       ├── auth.ts                   # API route auth helper (authenticateRequest)
│       ├── cache.ts                  # In-memory TTL cache for Meta API
│       ├── creative-types.ts         # Creative type taxonomy (6 groups, ~50 types)
│       ├── dropbox.ts                # Dropbox API client (OAuth, upload, save_url)
│       ├── klaviyo-api.ts            # Klaviyo campaign fetcher
│       ├── meta-api.ts              # Meta Marketing API (insights, copy analysis)
│       ├── redis.ts                  # Upstash Redis (rate limit, sync lock, PnL cache)
│       ├── releases.ts               # Release notes data
│       ├── supabase.ts               # Browser Supabase client
│       ├── supabase-server.ts        # Server Supabase client (service role)
│       ├── types.ts                  # TypeScript interfaces
│       ├── email/
│       │   ├── index.ts              # Email send function (Resend)
│       │   └── templates/            # Email HTML templates
│       ├── inngest/
│       │   ├── client.ts             # Inngest client + event types
│       │   ├── functions.ts          # Function registry
│       │   └── shopify-functions.ts  # Order/refund/uninstall handlers
│       └── shopify/
│           ├── config.ts             # Shopify app config (env vars, validation)
│           ├── crypto.ts             # HMAC verification for OAuth + webhooks
│           └── webhooks.ts           # Webhook topic registration
├── supabase/
│   ├── schema.sql                    # Original database schema
│   ├── fix-rls.sql                   # RLS infinite recursion fix
│   ├── migration-*.sql               # Individual migration files
│   ├── migrations/                   # Structured migrations
│   │   ├── add_batch_name_unique_constraint.sql
│   │   ├── allow_admin_insert_brands.sql
│   │   ├── create_brand_integrations.sql
│   │   ├── create_calendar_events.sql
│   │   └── create_feature_requests.sql
│   ├── sync-tallow-twins.sql         # Seed data for Tallow Twins
│   └── update-ad-spend.sql           # Manual ad spend backfill
├── CLAUDE_CODE_PROMPT_*.md           # Pending/documented changes (see section 10)
├── next.config.mjs                   # Next.js config (Sentry, CSP for Shopify)
├── vercel.json                       # Cron: /api/cron/sync-pending every 5 min
├── shopify.app.toml                  # Shopify app manifest
├── shopify.app.melchcloud.toml       # Shopify app manifest (production)
├── instrumentation.ts                # Sentry instrumentation
├── sentry.client.config.ts           # Sentry browser config
├── sentry.server.config.ts           # Sentry server config
├── sentry.edge.config.ts             # Sentry edge config
├── tailwind.config.ts                # Tailwind + brand colors
├── tsconfig.json                     # TypeScript config (path alias @/* -> ./src/*)
└── package.json                      # Dependencies
```

---

## 4. Database Schema

### Core Tables

#### `brands`
The central entity. Each brand is a DTC client.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| name | text | e.g. "Tallow Twins" |
| slug | text UNIQUE | e.g. "tallow-twins" |
| website_url | text | Brand website for favicons |
| shopify_store_domain | text | e.g. "tallowtwins.myshopify.com" |
| shopify_client_id | text | Custom app client ID (Dev Dashboard) |
| shopify_client_secret | text | Custom app client secret |
| shopify_gross_margin_pct | numeric | Default 62 |
| gross_margin_pct | numeric | P&L gross margin override |
| meta_ad_account_id | text | e.g. "act_736883766717486" |
| google_ads_customer_id | text | e.g. "6996956911" (no dashes) |
| dropbox_folder_path | text | Dropbox folder for file sync |
| archived_at | timestamptz | Soft-delete; non-null = archived |
| created_at | timestamptz | |

#### `users_profile`
One row per authenticated user. References Supabase auth.users.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK (FK auth.users) | |
| email | text | |
| full_name | text | |
| role | user_role ENUM | 'admin', 'strategist', 'founder', 'user' |
| brand_id | uuid FK brands | Which brand this user belongs to |
| created_at | timestamptz | |

#### `user_permissions`
Granular permission flags per user.

| Column | Type | Notes |
|--------|------|-------|
| user_id | uuid PK (FK auth.users) | |
| can_upload | boolean | |
| can_view_pipeline | boolean | |
| can_download | boolean | |
| can_delete | boolean | |
| is_active | boolean | False = deactivated |

#### `submissions`
A batch of uploaded creatives. One submission = one upload session.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| brand_id | uuid FK brands | |
| user_id | uuid FK auth.users | Who uploaded |
| batch_name | text UNIQUE | Auto-generated: {BRAND_CODE}\_{YYMMDD}\_{SEQ} |
| creative_type | creative_type ENUM | 'ugc', 'static', 'video', 'carousel', 'flexible', 'other' |
| creator_name | text | |
| landing_page_url | text | Default copy for the batch |
| copy_headline | text | |
| copy_body | text | |
| copy_cta | text | |
| copy_title | text | |
| notes | text | |
| status | file_status ENUM | Batch-level status |
| batch_status | batch_status ENUM | 'new', 'building', 'ready', 'launched' |
| launched_at | timestamptz | When batch was marked launched |
| is_carousel | boolean | |
| is_flexible | boolean | |
| is_whitelist | boolean | Creator/influencer whitelist |
| creator_social_handle | text | |
| drive_sync_status | text | 'pending', 'syncing', 'synced', 'partial', 'failed' |
| drive_sync_error | text | Error message if sync failed |
| drive_folder_url | text | Dropbox shared link |
| drive_folder_id | text | Dropbox folder path |
| drive_synced_at | timestamptz | |
| created_at | timestamptz | |
| updated_at | timestamptz | Auto-updated by trigger |

**Constraint:** `NOT (is_carousel AND is_flexible)` -- mutually exclusive

#### `submission_files`
Individual files within a submission batch. Each file in an upload gets a row.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| submission_id | uuid FK submissions | |
| file_name | text | |
| file_type | text | MIME type |
| file_size | bigint | |
| file_url | text | Path in Supabase Storage 'creatives' bucket |
| status | file_status ENUM | Per-file status |
| media_format | text | 'VIDEO', 'STATIC', 'AUDIO', 'DOCUMENT' |
| aspect_ratio | text | '1x1', '9x16', '4x5', '16x9', 'OTHER' |
| width | integer | |
| height | integer | |
| copy_headline | text | Per-file copy override |
| copy_body | text | |
| copy_cta | text | |
| landing_page_url | text | |
| copy_title | text | |
| launch_date | date | |
| launch_time | time | |
| ad_name | text | |
| notes | text | |
| product_id | text | Shopify product ID reference |
| product_name | text | Denormalized product title |
| creative_type | text | From creative-types.ts taxonomy |
| fidelity | text | 'high_def', 'lofi', 'other' |
| hook_angle | text | Hook/angle description |
| creative_concept | text | |
| tags | text[] | Free-form tags array |
| dropbox_path | text | Dropbox file path (for resumable sync) |
| dropbox_job_id | text | Async save_url job ID |
| created_at | timestamptz | |
| updated_at | timestamptz | Auto-updated by trigger |

#### `status_log`
Audit trail for file status changes.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| file_id | uuid FK submission_files | |
| old_status | file_status | |
| new_status | file_status | |
| changed_by | uuid FK auth.users | |
| changed_at | timestamptz | |

#### `daily_pnl`
One row per brand per day. Stores raw Shopify order metrics + ad spend.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| brand_id | uuid FK brands | |
| date | date | UNIQUE with brand_id |
| nc_orders | integer | New customer orders |
| nc_revenue | numeric | New customer revenue |
| rc_orders | integer | Returning customer orders |
| rc_revenue | numeric | Returning customer revenue |
| gross_sales | numeric | Total gross sales |
| discounts | numeric | Stored negative |
| refunds | numeric | Stored negative |
| taxes | numeric | Positive |
| shipping | numeric | Positive |
| meta_spend | numeric | Meta Ads daily spend |
| google_spend | numeric | Google Ads daily spend |
| other_spend | numeric | Other ad spend |
| synced_at | timestamptz | |
| created_at | timestamptz | |

#### `pnl_monthly_settings`
Monthly P&L overrides per brand (gross margin, off-Shopify revenue, other spend).

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| brand_id | uuid FK brands | |
| month | text | e.g. '2026-04', UNIQUE with brand_id |
| other_spend | numeric | |
| other_spend_locked | boolean | |
| off_shopify_revenue | numeric | |
| off_shopify_locked | boolean | |
| gross_margin_pct | numeric | |
| updated_at | timestamptz | |
| updated_by | uuid FK auth.users | |

#### `app_settings`
Key-value store for app-wide config (e.g., Meta access tokens).

| Column | Type | Notes |
|--------|------|-------|
| key | text PK | |
| value | text | |
| updated_at | timestamptz | |

#### `shopify_stores`
Tracks Shopify app installations (OAuth path).

| Column | Type | Notes |
|--------|------|-------|
| shop_domain | text PK | e.g. "tallowtwins.myshopify.com" |
| brand_id | uuid FK brands | Linked brand (if matched) |
| access_token | text | OAuth access token |
| scopes | text | Granted scopes |
| installed_at | timestamptz | |
| uninstalled_at | timestamptz | Non-null = uninstalled |
| shop_info | jsonb | Store metadata |
| registered_webhooks | jsonb | Webhook registration results |
| updated_at | timestamptz | |

#### `shopify_orders`
Raw Shopify order data for landing page analytics.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| shop_domain | text | |
| brand_id | uuid FK brands | |
| shopify_order_id | bigint | UNIQUE with shop_domain |
| order_number | text | |
| email | text | |
| total_price | numeric | |
| subtotal_price | numeric | |
| total_tax | numeric | |
| total_discounts | numeric | |
| currency | text | |
| financial_status | text | |
| fulfillment_status | text | |
| customer_id | bigint | |
| line_items | jsonb | |
| shipping_address | jsonb | |
| billing_address | jsonb | |
| source_name | text | |
| landing_site | text | URL the customer landed on |
| referring_site | text | |
| shopify_created_at | timestamptz | |
| shopify_updated_at | timestamptz | |
| raw | jsonb | Full Shopify payload |
| updated_at | timestamptz | |

#### `shopify_products`
Synced Shopify product catalog per brand.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| shop_domain | text | |
| brand_id | uuid FK brands | |
| shopify_product_id | bigint | UNIQUE with shop_domain |
| title | text | |
| handle | text | |
| status | text | 'active', 'draft', 'archived' |
| product_type | text | |
| vendor | text | |
| tags | text[] | |
| variants | jsonb | |
| images | jsonb | |
| shopify_created_at | timestamptz | |
| shopify_updated_at | timestamptz | |
| raw | jsonb | |
| updated_at | timestamptz | |

#### `brand_integrations`
API keys for third-party services per brand (e.g., Klaviyo).

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| brand_id | uuid FK brands | |
| provider | text | 'klaviyo', etc. UNIQUE with brand_id |
| api_key | text | |
| label | text | |
| created_at | timestamptz | |
| updated_at | timestamptz | |

#### `integrations`
App-level integrations (e.g., Dropbox OAuth tokens).

| Column | Type | Notes |
|--------|------|-------|
| service | text PK | 'dropbox' |
| refresh_token | text | |
| access_token | text | Cached short-lived token |
| access_token_expires_at | timestamptz | |
| updated_at | timestamptz | |

#### `calendar_events`
Manual marketing communications calendar.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| title | text | |
| channel | text | Default 'Other' |
| event_date | date | |
| brand_id | uuid FK brands | |
| created_at | timestamptz | |

#### `feature_requests` + `feature_votes`
Feature request board with voting system.

| Table | Key Columns |
|-------|-------------|
| feature_requests | id, title, description, status (open/planned/in_progress/shipped/declined), category, submitted_by, admin_note |
| feature_votes | id, feature_id, user_id, vote (+1/-1), UNIQUE(feature_id, user_id) |

### Views

- **`file_tracker`** -- Joins submission_files + submissions + brands for the pipeline view. Uses COALESCE to prefer per-file copy over batch-level copy.
- **`feature_request_scores`** -- feature_requests with aggregated vote counts (score, upvotes, downvotes).

### Key RLS Pattern

Most tables use RLS with a `public.is_admin()` security-definer function (defined in `fix-rls.sql`) to avoid infinite recursion when checking admin role. Pattern:
- Admins: full access via `public.is_admin()`
- Strategists/Founders: read/write own brand via `brand_id` match
- Users: read/write own submissions via `user_id` + `brand_id` join

### Triggers

- `update_updated_at_column()` -- auto-updates `updated_at` on submissions and submission_files
- `log_submission_file_status_change()` -- inserts into status_log when submission_files.status changes

---

## 5. API Routes

All routes are under `src/app/api/`. Auth is typically via `Authorization: Bearer <supabase_jwt>` header, validated using either `authenticateRequest()` from `src/lib/auth.ts` or inline Supabase auth checks.

### Shopify Integration

| Route | Method | Auth | Purpose |
|-------|--------|------|---------|
| `/api/shopify/install` | GET | None (public) | Starts OAuth install flow. Query: `?shop=x.myshopify.com` |
| `/api/shopify/callback` | GET | HMAC + state cookie | OAuth callback. Verifies HMAC, redirects to embedded admin |
| `/api/shopify/token-exchange` | POST | Session token (HS256 JWT) | Swaps Shopify session token for offline access token, upserts into shopify_stores, registers webhooks |
| `/api/shopify/webhooks/[topic]` | POST | HMAC header | Receives Shopify webhooks, dispatches to Inngest events |
| `/api/shopify-sync` | POST | Admin/Founder | Full Shopify sync: fetches orders, enriches customer NC/RC, aggregates daily_pnl, fetches Meta+Google ad spend, syncs products. `maxDuration: 300` |
| `/api/shopify-sync` | GET | Auth | Reads daily_pnl data for a brand+year. Cached in Redis (60s TTL) |
| `/api/sync-products` | POST | Admin | Standalone product sync from Shopify |
| `/api/external/shopify-ingest/[...path]` | POST | MELCH_GADGET_SECRET | Receives forwarded data from Gadget.dev connector. Sub-paths: /shop-installed, /shop-uninstalled, /order, /product |

### Creative Pipeline

| Route | Method | Auth | Purpose |
|-------|--------|------|---------|
| `/api/batch-name` | GET | Auth | Generates unique batch name: `{BRAND}_{YYMMDD}_{SEQ}` |
| `/api/batch-status` | PATCH | Admin | Updates batch_status (new/building/ready/launched) |
| `/api/batch-delete` | DELETE | Admin | Deletes submission + files + storage |
| `/api/batch-download` | POST | Auth + can_download | Generates ZIP of batch files from Supabase Storage |
| `/api/submissions/sync-drive` | POST | Service | Syncs submission files to Dropbox. Resumable per-file tracking |
| `/api/submissions/mark-launched` | POST | Admin | Marks batch as launched, sets launched_at |
| `/api/export` | GET | Auth | CSV export of file tracker data |
| `/api/brand-products` | GET | Auth | Returns shopify_products for a brand_id |
| `/api/creative-image/[batch]` | GET/POST | Auth | Creative image operations |
| `/api/copy-templates` | GET | Auth | Returns copy template library |

### Analytics

| Route | Method | Auth | Purpose |
|-------|--------|------|---------|
| `/api/meta-insights` | GET | Auth | Fetches Meta ad-level creative insights (thumbnails, video, metrics) |
| `/api/ad-media` | GET | Auth | Fetches single ad's creative media (thumbnail + video URL) |
| `/api/ad-changelog` | GET | Auth | Ad status changes over time (Meta + Google) |
| `/api/campaign-metrics` | GET | Auth | Campaign-level metrics |
| `/api/copy-analysis` | GET | Auth | Copy text performance analysis from Meta ads |
| `/api/landing-pages` | GET | Auth | Landing page attribution from shopify_orders |
| `/api/ticker-stats` | GET | Auth | Dashboard ticker: today's spend, revenue, ROAS |
| `/api/token-health` | GET | Admin | Checks Meta access token validity |
| `/api/pnl-settings` | GET/POST | Auth | Monthly P&L settings (gross margin, other spend, off-Shopify) |
| `/api/klaviyo/campaigns` | GET | Auth | Fetches Klaviyo email campaigns for calendar |

### Admin

| Route | Method | Auth | Purpose |
|-------|--------|------|---------|
| `/api/admin/onboard` | POST | Admin/Founder | Multi-action: create_brand, set_integrations, set_dropbox, create_users, archive_brand, restore_brand |
| `/api/admin/create-user` | POST | Admin | Create Supabase auth user + profile + permissions |
| `/api/admin/brand-setup` | POST | Admin | Update brand settings |
| `/api/admin/retry-sync` | POST | Admin | Retry failed Dropbox syncs |

### Other

| Route | Method | Auth | Purpose |
|-------|--------|------|---------|
| `/api/cron/sync-pending` | GET/POST | CRON_SECRET or Admin | Vercel Cron (every 5 min): picks up pending/failed Dropbox syncs |
| `/api/inngest` | GET/POST/PUT | Inngest signing key | Inngest function endpoint |
| `/api/notify` | POST | Service | Sends Slack + email notifications |
| `/api/email-test` | POST | Admin | Tests email templates |
| `/api/feature-requests` | GET/POST | Auth | Feature request CRUD |
| `/api/feature-requests/vote` | POST | Auth | Feature vote toggling |
| `/api/feature-requests/status` | PATCH | Admin | Update feature request status |

---

## 6. Authentication Flow

1. **Login**: User visits `/` (root page = login form). Supabase `signInWithPassword()` returns a JWT session.
2. **Session storage**: Supabase SSR stores session in cookies (`sb-<project>-auth-token`).
3. **Client-side auth**: Components use `createClient()` from `src/lib/supabase.ts` (browser client with anon key).
4. **API route auth**: Two patterns:
   - **`authenticateRequest()`** from `src/lib/auth.ts`: Tries Authorization header first, then cookie-based session. Returns `AuthResult` with user_id, email, role, brand_id, and permissions.
   - **Inline pattern**: Many routes create a service-role client and call `supabase.auth.getUser(token)` directly, then check `users_profile.role`.
5. **Role-based access**:
   - **Admin**: Full access to everything
   - **Strategist**: Read own brand's data, upload for own brand
   - **Founder**: Read/write own brand's P&L settings, upload, view pipeline
6. **Permissions**: `user_permissions` table provides granular flags (can_upload, can_view_pipeline, can_download, can_delete, is_active). Admins get all permissions by default.

### Shopify App Auth (Separate Flow)

The Shopify embedded app uses a separate auth flow:
1. Merchant clicks install -> `/api/shopify/install` redirects to Shopify authorize page
2. Shopify redirects back to `/api/shopify/callback` with HMAC-signed params
3. Callback verifies HMAC + state cookie, redirects to Shopify admin embedded URL
4. Embedded app (`/app`) loads App Bridge, gets a session token (JWT)
5. `/api/shopify/token-exchange` swaps session token for offline access token
6. Access token stored in `shopify_stores` table

---

## 7. Key Integrations

### Shopify

**Two auth paths coexist:**

1. **OAuth / Public App** (preferred, new path): Uses Shopify App Bridge token exchange. The app is installed from the Shopify App Store or via direct install link. Access token stored in `shopify_stores.access_token`. Used for webhook-driven order ingestion.

2. **Client Credentials / Custom App** (legacy path): Uses `shopify_client_id` and `shopify_client_secret` stored directly on the `brands` table. Token obtained via `client_credentials` grant at sync time. Used for the daily P&L sync when no OAuth install exists.

**Order sync** (`/api/shopify-sync` POST):
- Fetches all orders in date range via REST API (paginated, 250/page)
- Enriches customer order counts via GraphQL `nodes()` query for accurate NC/RC classification
- NC = first order ever for that customer (not just first in window)
- Aggregates into daily_pnl by day
- Also syncs products into `shopify_products`

**Webhook-driven ingestion**: Shopify webhooks -> `/api/shopify/webhooks/[topic]` -> Inngest events -> `shopify-functions.ts` -> upsert into `shopify_orders`

**Gadget.dev connector**: Alternative ingestion path via `/api/external/shopify-ingest/` for shops using the Gadget.dev Shopify connector. Auth via `MELCH_GADGET_SECRET`.

**Shopify app config**: `shopify.app.toml` defines the app. Client ID: `379ad0c5fe46c693184a6a8f3477436f`. Scopes: `read_customers,read_price_rules,read_discounts,read_fulfillments,read_inventory,read_locations,read_marketing_events,read_orders,read_products,read_returns`. API version: `2026-04`. Embedded: true.

### Meta Ads

- **Access token**: Stored as `META_ACCESS_TOKEN` env var. Also referenced via `app_settings` table key.
- **Business ID**: `META_BUSINESS_ID` env var for fetching ad accounts.
- **API version**: `v21.0`
- **Key functions** in `src/lib/meta-api.ts`:
  - `fetchCreativeInsights()`: Ad-level insights with thumbnail caching to Vercel Blob
  - `fetchCopyAnalysis()`: Extracts copy text from asset_feed_spec and object_story_spec, aggregates performance
  - `fetchAdAccounts()`: Lists all ad accounts (me/adaccounts + business endpoints)
  - `fetchAdMedia()`: Gets thumbnail + video URL for a single ad
- **Thumbnail caching**: Downloads full-res images from Meta CDN and stores in Vercel Blob (`creatives/` prefix) to avoid 64x64px blurry thumbnails
- **Rate limit handling**: Graceful degradation -- returns partial data if rate limited mid-pagination

### Google Ads

- **NOT direct API**: Uses **Windsor.ai** as a proxy (`WINDSOR_API_KEY` env var)
- **Endpoint**: `https://connectors.windsor.ai/google_ads`
- **Fields fetched**: `account_id, date, spend`
- **Customer ID**: Stored in `brands.google_ads_customer_id` (10-digit, no dashes). Formatted with dashes for Windsor API calls.
- **Used in**: `shopify-sync/route.ts` (fetchGoogle function), `ad-changelog/route.ts`, `ticker-stats/route.ts`

### Dropbox

- **App mode**: App folder mode (all paths relative to `/Apps/Melch.Cloud`)
- **OAuth**: Uses `DROPBOX_APP_KEY` and `DROPBOX_APP_SECRET` for OAuth2 with refresh tokens
- **Token storage**: `integrations` table (service='dropbox'), with cached short-lived access tokens
- **Connected account**: google@melch.media on Dropbox Plus 2TB
- **Upload mechanism**: `save_url` API -- Dropbox fetches directly from Supabase Storage signed URLs (no bytes through the serverless function)
- **Large file handling**: Chunked upload sessions for files > 150MB (8MB chunks)
- **Resumability**: Each file tracked individually via `submission_files.dropbox_path`. If function times out, cron picks up remaining files.
- **Folder structure**: `/{BrandName}/{BatchName}/` e.g. `/Tallow Twins/TLW_260530_0001/`
- **Admin connection**: `/admin/dropbox` page initiates OAuth flow

### Inngest

- **App ID**: `melch-cloud`
- **Endpoint**: `/api/inngest`
- **Functions**:
  - `hello-world` -- test function
  - `shopify-order-created` -- upserts order into shopify_orders (3 retries)
  - `shopify-order-updated` -- upserts order (3 retries)
  - `shopify-order-cancelled` -- upserts order (3 retries)
  - `shopify-refund-created` -- logs refund (3 retries)
  - `shopify-app-uninstalled` -- marks store as uninstalled (1 retry)
- **Events**: Dispatched from webhook handler, consumed by Inngest functions

### Redis / Upstash

- **Rate limiting**: 5 Shopify syncs per minute per brand (sliding window)
- **Sync locking**: Per-brand mutex (`lock:shopify-sync:{brandId}`, 120s TTL) prevents concurrent syncs
- **P&L caching**: `pnl:{brandId}:{year}` key, 60s TTL
- **Email dedup**: `email:dedupe:{key}` with configurable TTL
- **Graceful degradation**: Returns null/true if Redis unavailable (no env vars in local dev)

### Resend (Email)

- **Templates**: `creative-upload`, `welcome`, `sync-failure`
- **From address**: `melch.cloud <noreply@melch.cloud>` (configurable via `NOTIFICATION_FROM_EMAIL`)
- **Deduplication**: Redis-backed dedup with configurable TTL

### PostHog

- **Client-side**: Wrapped via `PostHogProvider` component
- **Configuration**: `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST`

### Sentry

- **Error tracking**: Browser + server + edge configs
- **Session replay**: Enabled on errors (0% session, 100% error)
- **Traces**: 10% sample rate

### Klaviyo

- **Per-brand API key**: Stored in `brand_integrations` table (provider='klaviyo')
- **Used for**: Marketing calendar -- fetches sent/scheduled email campaigns
- **API revision**: 2024-10-15

---

## 8. Environment Variables

### Supabase
| Variable | Purpose |
|----------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL (public) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key (public) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (server-only, bypasses RLS) |

### Shopify
| Variable | Purpose |
|----------|---------|
| `SHOPIFY_API_KEY` | Shopify app client ID |
| `SHOPIFY_API_SECRET` | Shopify app client secret |
| `SHOPIFY_SCOPES` | Requested OAuth scopes |
| `SHOPIFY_APP_URL` | App URL (default: https://melch.cloud) |

### Meta Ads
| Variable | Purpose |
|----------|---------|
| `META_ACCESS_TOKEN` | Meta Marketing API access token |
| `META_BUSINESS_ID` | Meta Business Manager ID (for ad account discovery) |

### Google Ads
| Variable | Purpose |
|----------|---------|
| `WINDSOR_API_KEY` | Windsor.ai API key for Google Ads data |

### Dropbox
| Variable | Purpose |
|----------|---------|
| `DROPBOX_APP_KEY` | Dropbox app key |
| `DROPBOX_APP_SECRET` | Dropbox app secret |

### Redis / Upstash
| Variable | Purpose |
|----------|---------|
| `UPSTASH_REDIS_REST_URL` | Upstash Redis REST URL |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis REST token |

### Email
| Variable | Purpose |
|----------|---------|
| `RESEND_API_KEY` | Resend API key for sending emails |
| `NOTIFICATION_FROM_EMAIL` | From address (default: noreply@melch.cloud) |
| `ADMIN_NOTIFICATION_EMAIL` | Alert recipient (default: melch@melch.media) |

### Inngest
| Variable | Purpose |
|----------|---------|
| `INNGEST_EVENT_KEY` | Inngest event sending key |
| `INNGEST_SIGNING_KEY` | Inngest function invocation signing key |

### Sentry
| Variable | Purpose |
|----------|---------|
| `NEXT_PUBLIC_SENTRY_DSN` | Sentry DSN (public) |
| `SENTRY_ORG` | Sentry organization slug |
| `SENTRY_PROJECT` | Sentry project slug |

### PostHog
| Variable | Purpose |
|----------|---------|
| `NEXT_PUBLIC_POSTHOG_KEY` | PostHog project API key (public) |
| `NEXT_PUBLIC_POSTHOG_HOST` | PostHog host URL (public) |

### Other
| Variable | Purpose |
|----------|---------|
| `NEXT_PUBLIC_APP_URL` | Application URL for email links |
| `NEXT_PUBLIC_SITE_URL` | Site URL (used in Dropbox OAuth redirect) |
| `CRON_SECRET` | Secret for Vercel Cron job authentication |
| `MELCH_GADGET_SECRET` | Auth secret for Gadget.dev Shopify connector |
| `SLACK_WEBHOOK_URL` | Slack webhook for notifications |

---

## 9. Key Business Concepts

### Creative Pipeline Flow

1. Strategist opens `/upload`, selects their brand
2. Drags files into the uploader (images/videos)
3. Fills in per-file metadata: product (from Shopify catalog), creative type (from taxonomy), hook/angle, copy, creator
4. Submits batch -> generates unique batch name (e.g., `TLW_260530_0001`)
5. Files uploaded to Supabase Storage (`creatives` bucket)
6. Dropbox sync triggered (fire-and-forget, resumable)
7. Batch appears in pipeline with status "new"
8. Admin progresses through: new -> building -> ready -> launched
9. Per-file status can be tracked: pending -> in_review -> approved -> scheduled -> live -> paused -> killed

### Creative Type Taxonomy

Defined in `src/lib/creative-types.ts`. Six groups:
1. **High Def -- Static**: ECom Product Shots, Campaign Product/Model Shots, Before & Afters, Skin Tone Shots, Swatches/Textures, Ingredient Callouts, Lifestyle Flat Lay
2. **High Def -- Video**: Beauty/Hero Shots, Application Demo, Model Interactions, AI Graphic Content, Product Reveal
3. **Lofi -- Static**: IRL Lifestyle, Creator Imagery, Swatches, Before & Afters, Review Screenshot
4. **Lofi -- Video**: Product Love Testimonials, Try Ons, Full Routine, Humor, Founder Story, BTS, GRWM, Problem->Solution, Myth Busting
5. **Other -- Static**: App Mockups, Billboard, Branded Asset, Comparison Chart, Meme, Text Overlay
6. **Other -- Video**: Animation, ASMR, Case Study, Celebrity/Influencer, Educational, Slideshow, Unboxing, Voiceover

Each type has a `fidelity` (high_def/lofi/other) and `format` (static/video).

### Daily P&L Sync

The P&L sync (triggered manually or could be scheduled) does:
1. Fetches Shopify orders for date range (default last 60 days)
2. Enriches customer data via GraphQL for accurate NC/RC classification
3. Aggregates into daily buckets: gross_sales, discounts, refunds, taxes, shipping, nc/rc splits
4. Fetches Meta spend (daily granularity via insights API) and Google spend (via Windsor.ai)
5. Merges order data + spend data into single upsert to `daily_pnl`
6. Also upserts raw orders into `shopify_orders` and products into `shopify_products`
7. Invalidates Redis cache

**NC/RC classification logic**: An order is "new customer" if and only if it is that customer's first order ever. The system uses Shopify GraphQL `numberOfOrders` (lifetime count) to determine this accurately, falling back to the embedded `customer.orders_count` if GraphQL enrichment fails.

### Spend-Only Sync

Can be triggered separately (action: 'sync_spend_only') for brands without Shopify connection but with Meta/Google ad accounts. Only writes spend columns to daily_pnl without touching order columns.

### Dropbox Sync (Resumable)

Files are tracked individually. Each `submission_file` has `dropbox_path` (final synced path) and `dropbox_job_id` (in-progress async transfer). The sync uses Dropbox `save_url` API so Dropbox downloads directly from Supabase Storage. A Vercel Cron job runs every 5 minutes to retry failed/stuck transfers.

---

## 10. Known Issues and Pending Work

### Active Issues

1. **MTE Shopify Connection**: The MTE (More Than Essentials) brand exists in the database but has no Shopify credentials configured. No `shopify_store_domain`, `shopify_client_id`, or `shopify_client_secret`. Cannot sync orders or products.

2. **Spend Sync Dual-Upsert Bug**: Documented in `CLAUDE_CODE_PROMPT_fix_spend_sync.md`. The fix has been implemented in the current code (spend is fetched in parallel with orders and merged into a single upsert). However, verify that the fix is deployed and working -- historical data from May 27-June 2 may still show zero spend.

3. **User Account for MTE**: `carlislestuder@gmail.com` needs a user account created and associated with the MTE brand.

### Pending Feature Work (Documented in CLAUDE_CODE_PROMPT_*.md)

| File | Status | Description |
|------|--------|-------------|
| `CLAUDE_CODE_PROMPT_fix_spend_sync.md` | Likely implemented | Fix dual-upsert race condition in P&L sync |
| `CLAUDE_CODE_PROMPT_remove_batch_defaults.md` | Pending | Remove batch defaults bar from upload form, move sync button |
| `CLAUDE_CODE_PROMPT_file_dedup.md` | Pending | Add duplicate file detection warnings to upload form |
| `CLAUDE_CODE_PROMPT_creative_tagging.md` | Partially done | Creative tagging schema (columns added, product dropdown WIP) |
| `CLAUDE_CODE_PROMPT_creative_matrix.md` | Pending | Creative diversity matrix page |
| `CLAUDE_CODE_PROMPT_upload_ui_cleanup.md` | Pending | Upload UI polish |
| `CLAUDE_CODE_PROMPT_upload_ui_redesign.md` | Pending | Upload UI redesign |
| `CLAUDE_CODE_PROMPT_upload_v2.md` | Pending | Upload v2 flow |
| `CLAUDE_CODE_PROMPT_fix_product_dropdown.md` | Pending | Product dropdown fixes |
| `CLAUDE_CODE_PROMPT_fix_product_id_bigint.md` | Pending | Fix product_id type (bigint vs text) |
| `CLAUDE_CODE_PROMPT_sync_products_button.md` | Pending | Standalone product sync button |

---

## 11. Deployment

### Vercel

- **Platform**: Vercel
- **Framework**: Next.js (auto-detected)
- **Production URL**: https://melch.cloud
- **Build**: `next build` (TypeScript errors and ESLint errors are ignored via next.config.mjs)
- **Cron jobs**: `/api/cron/sync-pending` every 5 minutes (configured in vercel.json)
- **Max duration**: Several routes use `maxDuration = 300` (5 minutes) for long-running operations
- **Blob storage**: Vercel Blob used for caching Meta ad thumbnails

### Development

```bash
npm run dev    # Start dev server on localhost:3000
npm run build  # Production build
npm run start  # Start production server
npm run lint   # ESLint
```

### Key Build Notes

- TypeScript errors are IGNORED during build (`ignoreBuildErrors: true`)
- ESLint errors are IGNORED during build (`ignoreDuringBuilds: true`)
- Path alias: `@/*` maps to `./src/*`
- CSP headers set for Shopify embedded app (`frame-ancestors` allows myshopify.com)

---

## 12. File Naming Conventions and Patterns

### Route Files
- App Router convention: `src/app/<path>/page.tsx` for pages, `src/app/api/<path>/route.ts` for API routes
- Dynamic routes use brackets: `[topic]`, `[[...path]]`
- All API routes export named handlers: `GET`, `POST`, `PATCH`, `DELETE`, `PUT`

### Components
- PascalCase filenames: `FileCard.tsx`, `SubmissionForm.tsx`, `StatusBadge.tsx`
- React.FC pattern with explicit Props interfaces
- Client components marked with `'use client'`
- Inline styles using Tailwind classes + occasional `style` prop for dynamic values

### Lib Files
- kebab-case filenames: `meta-api.ts`, `supabase-server.ts`, `creative-types.ts`
- Exported functions use camelCase
- Service clients are singletons or factory functions

### Database Naming
- snake_case for all table names and columns
- UUID primary keys (uuid_generate_v4 or gen_random_uuid)
- Foreign keys named descriptively: `brand_id`, `user_id`, `submission_id`
- Timestamps: `created_at`, `updated_at`, `synced_at`
- Enum types: `creative_type`, `file_status`, `user_role`, `batch_status`

### Batch Name Format
Auto-generated: `{BRAND_CODE}_{YYMMDD}_{SEQUENCE}` where:
- BRAND_CODE = first 3 chars of brand name uppercase (e.g., TLW for Tallow Twins)
- YYMMDD = date
- SEQUENCE = 4-digit zero-padded sequential number (0001, 0002, ...)
- Has UNIQUE constraint in database

### Color/Style Conventions
- Background: `#0a0a0a` (near-black)
- Text primary: `#f5f5f8` (off-white)
- Accent gold: `#c8b89a`
- Text secondary: `#ababab`
- Cards: `rgba(13, 13, 13, 0.5)` with `rgba(255, 255, 255, 0.08)` borders
- Interactive elements: gold hover states
- Status colors: green for success, amber for warnings, red for errors

---

## 13. Important Implementation Details

### Supabase Client Patterns

**Browser (client components)**:
```typescript
import { createClient } from '@/lib/supabase';
const supabase = createClient(); // uses anon key, respects RLS
```

**Server (API routes)**:
```typescript
import { createServiceClient } from '@/lib/supabase-server';
const supabase = createServiceClient(); // uses service role key, bypasses RLS
```

**Auth helper (API routes)**:
```typescript
import { authenticateRequest } from '@/lib/auth';
const { auth, error, status } = await authenticateRequest(request);
if (!auth) return NextResponse.json({ error }, { status });
```

### Meta API Token

The Meta access token is stored as the `META_ACCESS_TOKEN` environment variable. It may also be stored in the `app_settings` table. The `/api/token-health` route checks if it's still valid. Tokens expire and need periodic refresh -- this is a manual process currently.

### Shopify API Version

The codebase uses two API versions:
- `2024-01` in the REST API calls within `shopify-sync/route.ts`
- `2026-04` in the app configuration (`shopify.app.toml`) and `shopify/config.ts`

### Error Handling Pattern

Most API routes follow this pattern:
1. Validate auth
2. Parse request
3. Try business logic in try/catch
4. On error: log to console, send alert email (fire-and-forget), return error JSON with details
5. Sync failures send email notifications via Resend with Redis-backed deduplication

### Vercel Blob for Meta Thumbnails

Meta's CDN often returns 64x64px blurry thumbnails. The `meta-api.ts` module downloads full-resolution images and uploads them to Vercel Blob (`creatives/{creativeId}.jpg`). An in-memory cache of the blob list avoids hitting the Blob API on every request (5-minute TTL).

---

## 14. Quick Reference: Common Operations

### Creating a new brand
POST `/api/admin/onboard` with `action: 'create_brand'`, body: `{ name, slug, website_url, gross_margin_pct }`

### Creating a user for a brand
POST `/api/admin/onboard` with `action: 'create_users'`, body: `{ brand_id, users: [{ email, full_name, role }] }`

### Triggering a P&L sync
POST `/api/shopify-sync` with Authorization header, body: `{ brand_id, since_date?, until_date?, action? }`
- `action: 'sync_spend_only'` for spend-only sync

### Checking Dropbox sync status
Look at `submissions.drive_sync_status` -- values: pending, syncing, synced, partial, failed

### Adding a new page
1. Create `src/app/<path>/page.tsx`
2. Add navigation link in `src/components/Navbar.tsx`
3. Page should use `'use client'` directive
4. Check auth on mount, redirect to `/` if not authenticated

### Adding a new API route
1. Create `src/app/api/<path>/route.ts`
2. Export named handler functions (GET, POST, etc.)
3. Add `export const dynamic = 'force-dynamic'` for routes that need fresh data
4. Add `export const maxDuration = 300` for long-running operations
5. Use `authenticateRequest()` or inline auth check
6. Use `createServiceClient()` for database operations (bypasses RLS)
