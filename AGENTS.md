# Melch.Cloud — Agent Source of Truth

> **This file is the living canon for coding agents.**  
> `docs/archive/HERMES_PROJECT.md` is a historical Hermes dump (June 2026) and is **not** source of truth.  
> Currency detail: `docs/currency.md`. Trybe API contract: `docs/TRYBE_API_LOCKED.md` (locked from a Mintier probe on 2026-09-15).

## What it is / JTBD

**Melch.Cloud** is Melch Media’s multi-brand DTC marketing command center (prod: https://melch.cloud).

**Jobs to be done**
- Run the **creative pipeline**: upload → batch → review → Dropbox sync → launch.
- Run **paid media + commerce P&L**: Shopify revenue + Meta/Google spend → daily_pnl, dashboards, campaign/geo views.
- Give **founders** a locked, brand-scoped window into their own data; give **admins/strategists** ops control.

Do **not** invent brand rosters, spend, ROAS, or account IDs. Read live data from Supabase / APIs.

## Stack

| Area | Choice |
|------|--------|
| App | Next.js 14 App Router, TypeScript, Tailwind |
| Data/Auth | Supabase (Postgres + Auth + Storage). Project ref: `txetdixzcftzetqiuzan` |
| Host | Vercel → https://melch.cloud |
| Jobs | Inngest |
| Cache / rate limit | Upstash Redis |
| Email | Resend |
| Analytics / errors | PostHog, Sentry |
| Media blobs | Vercel Blob |
| Google Ads | **Pipeboard** Google MCP (`PIPEBOARD_API_TOKEN` / `app_settings.pipeboard_api_token`) — **not Windsor** |
| Meta Ads | Marketing API; token via `META_ACCESS_TOKEN` or `app_settings.meta_access_token` (**manual refresh**) |
| Shopify | **Dual paths**: OAuth/`shopify_stores` (preferred, webhooks) + legacy per-brand client-credentials on `brands` |
| Trybe | Per-brand key on `brand_integrations` (`provider = 'trybe'`). Read-only. See below. |
| Collaborator brands | Triple Whale where wired (`/api/triplewhale-sync`); do not expand onboarding in drive-by PRs |

Design: dark `#0a0a0a`, text `#f5f5f8`, gold `#c8b89a` (`brand.*` in Tailwind).

## Product map (plain English)

| Route | Who | What |
|-------|-----|------|
| `/` | public | Login |
| `/dashboard` | admin / strategist / founder | Home + ticker |
| `/upload`, `/submissions` | role-gated | Creative upload + pipeline |
| `/admin` | admin | Creative queue / ops |
| `/team` | admin | People, brand assignment, invite emails, connection-health chips, per-brand Trybe key |
| `/auth/set-password` | public (one-time link) | Set a password from an invite or recovery link, then enter the app |
| `/admin/onboard` | admin / founder | Onboarding wizard (create brand, integrations, invite users, archive) |
| `/admin/dropbox` | (no in-page role check) | Dropbox connect page. Start-route comment says admin; the handler does not enforce a role. |
| `/analytics/bfcm-pacing` | admin / strategist / founder | BFCM command center. Founders see the Performance nav. Shopify gross sales come from `shopify_orders` (same gross / new-customer helper as Daily P&L). Today, L7, and hours use the shop IANA zone, falling back to the ad account zone. Last year inside Nov 23–30 aligns by event day (Black Friday and Cyber Monday), otherwise the same weekday (minus 364 days). Shared goals live in `bfcm_goals` (`supabase/migrations/add_bfcm_goals.sql`). |
| `/analytics/daily-pnl` | admin / founder | Daily P&L in the brand’s reporting currency |
| `/analytics/campaigns`, `/analytics/geo-performance` | admin / founder / strategist | Campaigns; geo aMER |
| `/analytics/efficiency`, `/analytics/ltv-cohorts`, `/analytics/forecast`, `/analytics/creative-matrix`, `/analytics/ad-perspective` | — | Retired. Permanent redirects to `/dashboard` (`next.config.mjs`). |
| `/analytics/trybe-program` | admin / strategist / founder | Trybe Program Overview (read-only). Nav: Creative Analytics → **Trybe Program**. Excludes FOND. |
| `/analytics` (+ copy) | role-gated | Creative analytics. Top Creatives filters and groups by the landing-page product (`live_creatives`). |
| `/analytics/funnel-viewer` | admin / strategist / founder | Funnel Viewer constellation. Port of Odylic Constellation. One live route, `GET /api/funnel-viewer/ads`. Attribution default is 7-day click only (`FUNNEL_ATTRIBUTION` in `src/lib/meta-funnel.ts`). Non-admins are locked to `users_profile.brand_id`. |
| `/ad-changelog` | admin + founder | Live Meta `/activities` + Google Ads `change_event` feed (`ad_activity`). Cron `GET /api/cron/ad-activity` every 15 minutes. Admin brand picker lists non-archived brands; founder is locked to `users_profile.brand_id`. System events (Meta review, billing, spend limit, first delivery) are hidden until the toggle is on. |
| `/calendar` | — | Retired. Permanent redirect to `/dashboard` (`next.config.mjs`). |
| `/copy-templates`, `/ad-lab`, `/stats` | role-gated | Copy library, experiments, file stats |
| `/releases`, `/feature-requests`, `/account` | role-gated | App releases, FR board, profile |
| `/app` | Shopify embedded | App Bridge bootstrap |

**`/team` vs `/admin`:** `/team` = users & access; `/admin` = creative queue / admin tooling. Archive or restore brands via **`POST /api/admin/brand-setup`** (`action: 'archive' | 'unarchive'`) or onboard’s `archive_brand` / `restore_brand`. Soft-delete = `brands.archived_at`.

## Data essentials

- **`brands`** — source of truth for clients (Shopify domains, Meta `act_…`, Google customer id digits, margins, `archived_at`, legacy `shopify_client_id` / `shopify_client_secret`).
- **`users_profile` + `user_permissions`** — role (`admin` \| `strategist` \| `founder` \| `user`), brand lock, capability flags. Browser updates to `users_profile` do not stick (no UPDATE policy); assignment goes through **`POST /api/admin/update-user`** (service role).
- **`submissions` / `submission_files`** — creative batches + files + Dropbox sync state. `file_name` is the uploaded name, and Dropbox keeps that name. Tag columns (`original_file_name`, `auto_tags`, `tag_source`, plus file-level `creative_type`, `fidelity`, `product_id`, `product_name`, `hook_angle`) and `brands.file_naming_pattern` remain from `supabase/migrations/add_creative_auto_tags.sql`. The app does not write or read them. Batch `submissions.creative_type` is derived on upload: `carousel` or `flexible` when that toggle is on, otherwise `static` for image-only files, or `video`, `mixed`, or `other`. Image-only uses the historical `static` slug so Stats keeps one Static bar. Stats Creative Type Mix reads that column only. Historical values are left as stored. `usage_end_date` is an optional date for whitelist or creator usage (`supabase/migrations/add_usage_end_date.sql`). `notion_page_id` and `notion_page_url` remember the Agency Tasks page for that date.
- **`daily_pnl`** — one row per brand per day (Shopify NC/RC + Meta/Google/other spend). **`daily_pnl.currency`** is the ISO-4217 reporting currency for that row (Shopify/store settlement). Spend is converted into it at sync. NULL until the row is re-synced after the migration (`supabase/migration-daily-pnl-currency.sql` and `supabase/migrations/add_daily_pnl_reporting_currency.sql`).
- **`brand_integrations`** — per-brand provider credentials. Trybe rows use `provider = 'trybe'`, `api_key` (never returned raw; masked in the integration API), and `metadata` JSON: `trybe_brand_id`, `trybe_program_id`, `trybe_program_name`. Metadata column: `supabase/migrations/add_brand_integrations_metadata.sql`.
- **`ad_activity`** — one row per Meta activity or Google `change_event` (`supabase/migrations/add_ad_activity.sql`). `ad_activity_sync` stores last success and last error per brand and platform. The changelog no longer reads `ad_changelog` / `ad_snapshots`. `src/app/api/ad-media/route.ts` still selects `ad_snapshots`.
- Supporting: `shopify_stores` / `shopify_orders` / `shopify_products`, `app_settings`, `integrations` (Dropbox), feature-request tables. `calendar_events` remains after the Calendar page was retired; the app does not read it.

Prefer service-role clients only on the server. Browser uses anon key + RLS.

## Creative upload

- `/upload` is drag-and-drop files, an automatic batch name, and optional note, creator, handle, landing page, copy template, and carousel / flexible / whitelist flags. A usage end date appears when whitelist is on or a creator name or @handle is entered. The date is optional and must be today or later. A user with one brand (or a `users_profile.brand_id`) is locked to that brand. Batch `submissions.creative_type` is `carousel` or `flexible` when that toggle is on, otherwise `static` for image-only files, or `video`, `mixed`, or `other`. Stats Creative Type Mix reads that column. Files keep their original names in storage and in Dropbox.
- A saved `usage_end_date` asks the server to create an Agency Tasks page: name `Turn off {Brand} {creator} Whitelisted Ads` (`Creator Ads` when whitelist is off), type `TURN OFF ON DUE DATE`, priority `P0`, status `To Do`, waiting on `Internal`, due that date. Client is the Active Clients row with the same brand name, or the brand name is written in Notes. The Melch link is `https://melch.cloud/admin#batch-{id}`. A later edit of the date updates that page's Due. `NOTION_API_KEY` is required. `NOTION_TASKS_DATA_SOURCE_ID` defaults to `55b17106-6328-4afd-a945-fb10314a9bb5` and `NOTION_CLIENTS_DATA_SOURCE_ID` defaults to `ec00e9d0-4d83-4c56-911c-602ead732456`. A missing key or a Notion error does not fail the upload. A failed Active Clients lookup still creates the task without Client. `GET /api/cron/usage-tasks` (hourly at :45, `CRON_SECRET`) creates tasks still missing for a current end date. Its JSON adds `failures` for each row that did not save a page (`page_create` or `submissions_update`) and `warnings` when client lookup failed. Each entry has `submissionId`, `step`, Notion HTTP `status`, Notion `code`, and `message` with tokens and secrets removed. `POST /api/submissions/usage-task` returns that `failure` or `warning` only for an admin (`due_update` when an existing page's Due did not change). That read uses `createServiceClient`, whose fetch sets `cache: 'no-store'`, and the route sets `fetchCache = 'force-no-store'` and `revalidate = 0`. Next.js 14 otherwise caches the PostgREST GET and later runs never reach Supabase. Apply `supabase/migrations/add_usage_end_date.sql` before the column is written.
- Submit does not wait on Dropbox. `POST /api/submissions/sync-drive` copies each file under its uploaded `file_name` and, when `notify: true`, sends the upload email and Slack notice. It requires an authenticated admin, a user on that submission's brand, or `Authorization: Bearer CRON_SECRET`. `GET /api/cron/sync-pending` resumes unfinished copies. There is no upload-time auto-tag or rename step. `XAI_API_KEY` is unused by this flow and stays in the environment.
- Creative Matrix and Ad Perspective are retired. `/analytics/creative-matrix` and `/analytics/ad-perspective` redirect to `/dashboard`. `/api/meta-insights` and `/api/campaign-metrics` stay: Top Creatives, Copy Analysis, and Campaigns still call them. `src/lib/meta-api.ts` stays for Creative Analytics, Funnel Viewer, and BFCM.

## Trybe Program

- Page: `/analytics/trybe-program`. API: `GET /api/trybe` (`tab=overview|leaderboard|top-ads|all`). Key admin save: `GET`/`POST /api/trybe/integration` (POST is admin-only). UI save lives on Team → brand settings.
- Roles: admin, strategist, founder. Non-admins are queried to their own `brand_id`. FOND is excluded (slugs `fond`, `fond-regenerative`, `fond-bone-broth`, or name `fond` / `fond …`). API returns 400 `FOND is excluded from Trybe Program Overview`.
- v1 is **read-only** (no approve/reject). Contract and endpoint list: `docs/TRYBE_API_LOCKED.md`. Client: `src/lib/trybe-api.ts`.
- Top ads do not invent spend. Trybe submissions expose `ads.count` and a date range, not per-ad spend. Cards are one creative per `trybe_id`. Spend/impressions/purchases come from a Meta join when `ad_name` contains `trybe=<id>`; otherwise show n/a.

## Geo Performance

Implemented in `src/app/api/geo-performance/route.ts`.

- **Shop-timezone windows.** The date range is the shop’s IANA zone (`shop.json` `iana_timezone`), not UTC. “Last N days” is N full shop-local days ending **yesterday**. `this_month` is the 1st of the shop-local month through **today**. Orders are kept when `shopify_created_at` falls on a shop-local calendar date inside that window. If the zone cannot be read, the window falls back to UTC and the response warns.
- **New customer = Shopify lifetime first order.** A kept non-voided order is NC only when it is that customer’s earliest stored non-voided order **and** the stored non-voided count is ≥ `Customer.numberOfOrders` (GraphQL, same lifetime count shopify-sync uses). If lifetime is greater than what we stored, earlier orders exist and nothing stored counts as new. Guest checkouts (no `customer_id`) count as NC. If the lifetime lookup fails, new-customer orders are omitted rather than guessed from partial history (totals still include the orders). Grouping is shipping country, then billing.
- **Pre-count catch-up.** Before counting, if Shopify auth resolves, the handler pulls orders missing from `shopify_orders` for the window (`catchUpShopifyOrders`) so a stale table cannot undercount. A failed pull warns and counts what is already stored.

## Reporting currency

One reporting currency per brand = Shopify / store settlement currency. Do not invent one.

Resolution (`src/lib/currency.ts` `resolveReportingCurrency`): explicit override → `shopify_stores.shop_info` currency → majority `shopify_orders.currency` → Meta account currency → Google customer currency → USD last resort.

`/api/shopify-sync` converts Meta/Google spend into that currency **before** upserting `daily_pnl` and tags `daily_pnl.currency`. If the column is not migrated yet, the upsert retries without it. Client pages that read `daily_pnl` display: tagged `daily_pnl.currency` → `shopify_stores.shop_info` → USD. Shared formatters: `makeFmt` in `src/lib/format.ts`. FX is a USD pivot from `open.er-api.com` (1h cache, static fallback). Full surface list and residual risks: `docs/currency.md`.

## Onboarding, invites, brand health

- **Brand assignment.** `POST /api/admin/update-user` (admin only): `update_role` and `update_brand`. Team calls this; do not write `users_profile.brand_id` from the browser.
- **Invites.** `src/lib/invite.ts` `ensureUserWithInviteLink` mints a Supabase `generateLink` (invite, or recovery if the auth user already exists). `generateLink` does not send mail. `src/lib/invite-mail.ts` `sendInviteEmail` emails `/auth/set-password?token_hash&type=` through the same Resend `sendEmail` helper as creative notices (`src/lib/email/templates/welcome.ts`). Delivered means Resend returned a message id (`Invite email delivered to …`). The copyable link is returned only to an admin, and only when that send fails, with Resend’s error (or `RESEND_API_KEY is not set`). Each attempt is one row in `invite_sends` (`supabase/migrations/add_invite_sends.sql`): user, brand, source (`team` \| `onboard` \| `resend` \| `self-service`), `resend_message_id` or `error`. An admin can invite or resend for any brand, including an existing account. A founder can invite only a brand-new email onto their own `brand_id` (`POST /api/admin/create-user` and onboard `create_users`). If that email already has an auth user or a profile, the response is 409 `That email already has an account; ask an admin.` A founder never receives `actionLink`, cannot skip the email, and cannot set a temp password. Temp passwords are admin-only and never change an existing password. `POST /api/admin/resend-invite` for a founder is limited to a non-admin on their brand who has never signed in, and still does not return the link. Onboard `create_brand`, `archive_brand`, and `restore_brand` are admin-only. `set_integrations` and `set_dropbox` are own-brand for a founder. A non-admin with no `brand_id` is rejected. `POST /api/auth/request-set-password` is recovery only (no new accounts), one email per address every two minutes, 5 requests per 15 minutes per IP, and 40 per 24 hours overall (`src/lib/set-password-limit.ts`, Upstash when configured, otherwise an in-memory IP window plus `invite_sends`). Default `user_permissions` by role: `src/lib/role-defaults.ts`.
- **Connection health.** `GET /api/admin/brand-health` (admin only, optional `brandId`). Read-only chips on Team brand cards: Shopify, Webhooks, Meta, Google, Dropbox, Triple Whale, currency, last `daily_pnl` sync. No secrets in the response. A live `shopify_stores` token (not `gadget-managed`) is green Shopify. Client-credentials without that token are yellow. A shop domain with no Shopify token is the Triple Whale path (Organic Jaguar): the Webhooks chip says webhooks cannot be registered. A custom app that lacks a webhook scope turns the Webhooks chip red and names `missing_scope`. Triple Whale is green only when `shopify_store_domain` is set, there is no live install and no custom-app creds, and `TRIPLEWHALE_API_KEY` is set.

## Shopify orders

No active customer brand has a `shopify_stores` row. FOND Regenerative, Mintier, and Tallow Twins use per-brand custom-app credentials (`shopify_client_id` / `shopify_client_secret` + `shopify_store_domain`). Organic Jaguar has `organicjaguar.myshopify.com` and no Shopify token; its orders are `source_name = triplewhale-sync`. Party Patch has no shop domain.

Webhook HMAC accepts `SHOPIFY_API_SECRET` or the brand's `shopify_client_secret`, looked up by `X-Shopify-Shop-Domain`. Unsigned payloads are rejected. Brand resolution uses `shopify_stores.brand_id`, then `brands.shopify_store_domain`.

`GET /api/cron/shopify-orders` runs every 2 hours at minute 20 (`20 */2 * * *`). Each run, for every active non-archived brand:

1. Ensures `orders/create`, `orders/updated`, and `orders/cancelled` for brands with custom-app credentials. `already_registered` is success. A missing scope is logged and stored on the Team Webhooks chip; it does not fail the run. Organic Jaguar is not included — Triple Whale cannot sign Shopify webhooks. `POST /api/admin/shopify-webhooks` remains for a manual retry.
2. Refreshes `daily_pnl` by calling `runShopifyBrandSync` (same function as `POST /api/shopify-sync`) or `runTripleWhaleBrandSync` (same function as `POST /api/triplewhale-sync`). The window is the shop's IANA calendar (`shop.json` `iana_timezone`, cached on `app_settings` key `shop_iana_timezone:{brandId}`; UTC if the zone cannot be read). It starts at local midnight of the earlier of (today minus 3) and (that brand's newest `daily_pnl` date minus 1), and is capped at 45 days. A gap longer than 10 days syncs the oldest 10 only; the next run continues at that chunk's end. Days the fetch does not cover completely, including the in-progress shop day, are not written. Every fully covered shop-local day is written, including a day with zero orders (explicit zeros). A non-OK orders page retries 429 up to 3 times using Retry-After (2s if the header is missing) and then throws `Shopify orders page ${status}`, so that run writes no daily_pnl rows. A payload whose `orders` field is not an array throws the same way. When a Meta or Google spend fetch succeeds, covered days missing from that result are written as 0; a failed or unattempted fetch omits that column and does not zero it. The `daily_pnl` upsert uses `defaultToNull: false`, so an omitted spend column does not wipe `meta_spend` / `google_spend`. Reporting currency is unchanged. A domain with no Admin token uses Triple Whale. A brand with no shop domain is skipped. Brands not started before the time budget are deferred, not failed. After the order pull, the same cron compares `daily_pnl.gross_sales` to `shopify_orders` gross (subtotal + discounts, voided excluded) for Shopify Admin brands over the last 14 complete shop-local days and stores mismatches over 2% on `app_settings` key `daily_pnl_integrity`. Triple Whale-only brands (Organic Jaguar) are skipped. The check does not start when under 20 seconds remain before the route's 300s limit, and it stops between brands if that deadline is hit. Rebuild one brand from stored orders: `POST /api/admin/rebuild-daily-pnl` (admin session or `Bearer CRON_SECRET`). Days before that brand's earliest stored `shopify_orders.shopify_created_at` (shop-local) are skipped, and a brand with no stored orders is not zero-filled.
3. Pulls `shopify_orders` since the newest stored row, at least the last 48 hours, and never further back than 45 days. A gap longer than 10 days pulls the oldest 10 (`created_at` ascending) and the next run continues. Admin API for credentialed brands, Triple Whale for domain-only brands.

`refunds/create` is not registered. That handler only logs. `orders/updated` upserts the order, including refunds on `raw`.

Do not invent `shopify_stores` rows. Do not register Shopify webhooks for a brand with no Admin token. A `gadget-managed` install token is not an Admin API token; custom-app credentials are used instead.

## BFCM command center

`GET /api/bfcm-pacing` is shop-local. Shopify revenue is `shopify_orders` gross (subtotal + discounts) through the same new-customer classification as Daily P&L. MER is that gross divided by Meta + Google spend; aMER uses new-customer gross. A last-year day before the brand's earliest stored order is `no_last_year_data`. The page shows `no data` for that day, not $0. Meta `time_range` dates use the ad account timezone, fetched only when Meta is configured and remembered for an hour. A since/until after that account-local today is clamped, and a range that has not started (the BFCM window before it opens) is not requested. Today is cached 60 seconds; L7, last year, and the BFCM window are cached 15 minutes. Meta insights use an `Authorization` header, not `access_token` in the URL. One ranged hourly call covers L7.

Goals: `PUT /api/bfcm-goals` with `{ brandId, date, revenueGoal, spendBudget, amerTarget }`. Admins write any brand. Founders write their own. Strategists read their own. Apply `supabase/migrations/add_bfcm_goals.sql` before saving goals.

Order backfill is admin-only or `Authorization: Bearer CRON_SECRET`. It does not run in this app's cron and does not rebuild `daily_pnl`. Call the same body again while `truncated` is true. A finished call with 0 orders and a `start_date` older than 60 days is not success: the JSON `warning` names `read_all_orders` and the status is 422. Custom apps without that scope only return the last 60 days.

```
POST /api/admin/shopify-order-backfill
{ "brand_name": "Mintier", "start_date": "2025-11-15", "end_date": "2025-12-05" }
```

Use `"brand_name": "Tallow Twins"` for that brand. The cursor is stored server-side.

## Live ad product tags

Step 1 is rules-based. No AI. `GET /api/cron/live-creatives` runs hourly at minute 10 (`Bearer CRON_SECRET`) and upserts `live_creatives` for active Meta ads on brands that have a Meta account. Apply `supabase/migrations/add_live_creatives.sql` before the cron can write. One row per brand, platform `meta`, ad, and asset. Flexible ads are one row per image hash or video id. Catalog ads use `catalog:{ad_id}`. The product comes from the ad's own landing URL, matched to the brand's myshopify domain and custom domain. A carousel uses the first card and stores every card. `manual_product_*` is the override and wins on read (`effectiveProduct`). The cron and admin sync omit `manual_product_*` and `product_source` from the upsert, so an override saved after the read stays, and a new row leaves those columns null. Top Creatives (`/analytics`) has a product filter and a By product view (active creatives, spend, ROAS, CPA — same sums as the page). Admins and founders override from the card (`PUT /api/live-creatives/override`). Strategists read their own brand. Founders can update their own brand (`FOR UPDATE`); admins keep `FOR ALL`. Admin sync is `POST /api/live-creatives/sync`. Reads use `createServiceClient` (`cache: 'no-store'`) and the routes set `fetchCache = 'force-no-store'` and `revalidate = 0`. Meta calls send the token in the Authorization header.

## Ship / ops footguns

1. **No secrets in chat, docs, commits, or screenshots.** Env + Vercel + `app_settings` only. Trybe keys stay on `brand_integrations.api_key`.
2. **Service role** (`SUPABASE_SERVICE_ROLE_KEY`) — Vercel/server routes only. Never ship it to the client.
3. **Browser / ops UI** — anon key + RLS. Don’t bypass RLS from the browser. Brand assignment is a server route for this reason.
4. **Never invent** brand lists, metrics, tokens, currencies, or “looks right” spend. Query or say unknown.
5. **Google Ads** = Pipeboard (`src/lib/pipeboard-google.ts`). Normalize customer IDs with `normalizeCustomerId` (digits only). Windsor is retired.
6. **Meta token** expires; refresh manually into env / `app_settings`. Use `/api/token-health` when diagnosing.
7. **Ad Changelog** is a live feed. `GET /api/cron/ad-activity` runs every 15 minutes (`CRON_SECRET`) and upserts `ad_activity` on `event_key`. First run backfills Meta 7 days and Google 14 days; later runs overlap the last success (Meta 10 minutes, Google 15). Google’s query stays inside 29 days. Per-brand **Refresh** is `POST /api/ad-changelog`, about once a minute, admin or founder on their own brand. Missing Meta token → `Meta: META_ACCESS_TOKEN not configured`. Missing Pipeboard token → `Google: PIPEBOARD_API_TOKEN not configured`. Those strings land on `ad_activity_sync.last_error` and the page. Apply `supabase/migrations/add_ad_activity.sql` before the cron can write. Founder requests for another brand are 403.
8. Don’t expand Triple Whale onboarding or “fix the TS build” as drive-by scope unless that is the task. Organic Jaguar’s orders and Daily P&L come from the scheduled Triple Whale pull, not a Shopify webhook.

## Working here

- Path alias: `@/*` → `src/*`.
- Local: `npm install` then `npm run dev` (needs env mirroring Vercel for real data).
- Cron: `vercel.json` → `/api/cron/sync-pending` every 5 minutes (Dropbox resume), `/api/cron/shopify-orders` every 2 hours at minute 20 UTC, `/api/cron/ad-activity` every 15 minutes, and `/api/cron/live-creatives` hourly at minute 10. All use `CRON_SECRET`. The 5-minute Dropbox cron is already running in production, so this project accepts sub-daily schedules.
- Agents: prefer this file over archived Hermes. Update **this** file when product truth changes.
