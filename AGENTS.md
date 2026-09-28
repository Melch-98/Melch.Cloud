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
| `/team` | admin | People, brand assignment, invite links, connection-health chips, per-brand Trybe key |
| `/admin/onboard` | admin / founder | Onboarding wizard (create brand, integrations, invite users, archive) |
| `/admin/dropbox` | (no in-page role check) | Dropbox connect page. Start-route comment says admin; the handler does not enforce a role. |
| `/analytics/bfcm-pacing` | admin / strategist / founder | BFCM command center. Founders see the Performance nav. |
| `/analytics/daily-pnl` | admin / founder | Daily P&L in the brand’s reporting currency |
| `/analytics/campaigns`, `/analytics/geo-performance` | admin / founder / strategist | Campaigns; geo aMER |
| `/analytics/efficiency`, `/analytics/ltv-cohorts`, `/analytics/forecast` | admin / founder | Efficiency, LTV, forecast — display via reporting currency |
| `/analytics/trybe-program` | admin / strategist / founder | Trybe Program Overview (read-only). Nav: Creative Analytics → **Trybe Program**. Excludes FOND. |
| `/analytics` (+ copy, ad perspective, matrix) | role-gated | Creative analytics. Matrix is admin + strategist. |
| `/ad-changelog` | admin + founder | Meta/Google status & budget diffs (snapshot-based; **manual “Refresh Now”** — no weekly cron). Admin brand picker lists non-archived brands; founder is locked to `users_profile.brand_id`. |
| `/calendar`, `/copy-templates`, `/ad-lab`, `/stats` | role-gated | Calendar, copy library, experiments, file stats |
| `/releases`, `/feature-requests`, `/account` | role-gated | App releases, FR board, profile |
| `/app` | Shopify embedded | App Bridge bootstrap |

**`/team` vs `/admin`:** `/team` = users & access; `/admin` = creative queue / admin tooling. Archive or restore brands via **`POST /api/admin/brand-setup`** (`action: 'archive' | 'unarchive'`) or onboard’s `archive_brand` / `restore_brand`. Soft-delete = `brands.archived_at`.

## Data essentials

- **`brands`** — source of truth for clients (Shopify domains, Meta `act_…`, Google customer id digits, margins, `archived_at`, legacy `shopify_client_id` / `shopify_client_secret`).
- **`users_profile` + `user_permissions`** — role (`admin` \| `strategist` \| `founder` \| `user`), brand lock, capability flags. Browser updates to `users_profile` do not stick (no UPDATE policy); assignment goes through **`POST /api/admin/update-user`** (service role).
- **`submissions` / `submission_files`** — creative batches + files + Dropbox sync state.
- **`daily_pnl`** — one row per brand per day (Shopify NC/RC + Meta/Google/other spend). **`daily_pnl.currency`** is the ISO-4217 reporting currency for that row (Shopify/store settlement). Spend is converted into it at sync. NULL until the row is re-synced after the migration (`supabase/migration-daily-pnl-currency.sql` and `supabase/migrations/add_daily_pnl_reporting_currency.sql`).
- **`brand_integrations`** — per-brand provider credentials. Trybe rows use `provider = 'trybe'`, `api_key` (never returned raw; masked in the integration API), and `metadata` JSON: `trybe_brand_id`, `trybe_program_id`, `trybe_program_name`. Metadata column: `supabase/migrations/add_brand_integrations_metadata.sql`.
- Supporting: `ad_changelog` / `ad_snapshots` (changelog diffs), `shopify_stores` / `shopify_orders` / `shopify_products`, `app_settings`, `integrations` (Dropbox), calendar + feature-request tables.

Prefer service-role clients only on the server. Browser uses anon key + RLS.

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
- **Invites.** `src/lib/invite.ts` `ensureUserWithInviteLink` (Supabase `generateLink` invite, or recovery if the auth user already exists). Used by `POST /api/admin/create-user` and onboard `create_users`. Welcome email (Resend, `src/lib/email/templates/welcome.ts`) carries the one-time set-password link. If email does not send, the admin UI gets the action link. Default `user_permissions` by role: `src/lib/role-defaults.ts`.
- **Connection health.** `GET /api/admin/brand-health` (admin only, optional `brandId`). Read-only chips on Team brand cards: Shopify, Meta, Google, Dropbox, Triple Whale, currency, last `daily_pnl` sync. No secrets in the response. Shopify OAuth install (live `shopify_stores` row) is green. Client-credentials (`shopify_client_id` + `shopify_client_secret`) or a domain without OAuth is yellow (“no OAuth install”), not green. Triple Whale is green only when `shopify_store_domain` is set, there is no OAuth install and no custom-app creds, and `TRIPLEWHALE_API_KEY` is set. A domain alone is not “healthy TW”.

## Known gap — Tallow Twins and Mintier Shopify

Tallow Twins and Mintier connect through **per-brand Shopify client-credentials apps** (`brands.shopify_client_id` / `shopify_client_secret`). They have **no `shopify_stores` row**, so `orders/create` webhooks are not registered. `shopify_orders` moves when someone runs `/api/shopify-sync`, or when Geo Performance’s catch-up pull succeeds. This is being fixed separately. Do not invent `shopify_stores` rows or webhook registration in unrelated PRs.

## Ship / ops footguns

1. **No secrets in chat, docs, commits, or screenshots.** Env + Vercel + `app_settings` only. Trybe keys stay on `brand_integrations.api_key`.
2. **Service role** (`SUPABASE_SERVICE_ROLE_KEY`) — Vercel/server routes only. Never ship it to the client.
3. **Browser / ops UI** — anon key + RLS. Don’t bypass RLS from the browser. Brand assignment is a server route for this reason.
4. **Never invent** brand lists, metrics, tokens, currencies, or “looks right” spend. Query or say unknown.
5. **Google Ads** = Pipeboard (`src/lib/pipeboard-google.ts`). Normalize customer IDs with `normalizeCustomerId` (digits only). Windsor is retired.
6. **Meta token** expires; refresh manually into env / `app_settings`. Use `/api/token-health` when diagnosing.
7. **Ad Changelog** scans on demand (POST `/api/ad-changelog`). There is **no** Vercel weekly cron; operators click **Refresh Now**. Missing Meta token → `Meta: META_ACCESS_TOKEN not configured`. Missing Pipeboard token → `Google: PIPEBOARD_API_TOKEN not configured`. The page shows those strings in the error banner (`scanError`). First scan seeds snapshots (many `new_entity` rows); later scans emit status/budget/removed diffs. Google budgets are not returned by Pipeboard (status-only for Google). Founder requests for another brand are 403.
8. Don’t expand Triple Whale onboarding, paper over the Tallow/Mintier webhook gap, or “fix the TS build” as drive-by scope unless that is the task.

## Working here

- Path alias: `@/*` → `src/*`.
- Local: `npm install` then `npm run dev` (needs env mirroring Vercel for real data).
- Cron today: `vercel.json` → `/api/cron/sync-pending` every 5 minutes (Dropbox resume), auth via `CRON_SECRET`.
- Agents: prefer this file over archived Hermes. Update **this** file when product truth changes.
