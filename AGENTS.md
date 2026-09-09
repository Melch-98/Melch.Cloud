# Melch.Cloud — Agent Source of Truth

> **This file is the living canon for coding agents.**  
> `docs/archive/HERMES_PROJECT.md` is a historical Hermes dump (June 2026) and is **not** source of truth.

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
| Shopify | **Dual paths**: OAuth/`shopify_stores` (preferred) + legacy client-credentials on `brands` |
| Collaborator brands | Triple Whale where wired (`/api/triplewhale-sync`); do not expand onboarding in drive-by PRs |

Design: dark `#0a0a0a`, text `#f5f5f8`, gold `#c8b89a` (`brand.*` in Tailwind).

## Product map (plain English)

| Route | Who | What |
|-------|-----|------|
| `/` | public | Login |
| `/dashboard` | admin / strategist / founder | Home + ticker |
| `/upload`, `/submissions` | role-gated | Creative upload + pipeline |
| `/admin` | admin | Creative queue / ops |
| `/team` | admin | People + brand user management (not the creative queue) |
| `/admin/onboard`, `/admin/dropbox` | admin | Onboarding wizard, Dropbox OAuth |
| `/analytics/*` | role-gated | Performance + creative analytics (BFCM, daily P&L, campaigns, geo, efficiency, LTV, forecast, creatives, copy, matrix, …) |
| `/ad-changelog` | admin + founder | Meta/Google status & budget diffs (snapshot-based; **manual “Refresh Now”** — no weekly cron) |
| `/calendar`, `/copy-templates`, `/ad-lab`, `/stats` | role-gated | Calendar, copy library, experiments, file stats |
| `/releases`, `/feature-requests`, `/account` | role-gated | App releases, FR board, profile |
| `/app` | Shopify embedded | App Bridge bootstrap |

**`/team` vs `/admin`:** `/team` = users & access; `/admin` = creative queue / admin tooling. Archive or restore brands via **`POST /api/admin/brand-setup`** (`action: 'archive' | 'unarchive'`) or onboard’s `archive_brand` / `restore_brand`. Soft-delete = `brands.archived_at`.

## Data essentials

- **`brands`** — source of truth for clients (Shopify domains, Meta `act_…`, Google customer id digits, margins, `archived_at`).
- **`users_profile` + `user_permissions`** — role (`admin` \| `strategist` \| `founder` \| `user`), brand lock, capability flags.
- **`submissions` / `submission_files`** — creative batches + files + Dropbox sync state.
- **`daily_pnl`** — one row per brand per day (Shopify NC/RC + Meta/Google/other spend).
- Supporting: `ad_changelog` / `ad_snapshots` (changelog diffs), `shopify_stores` / `shopify_orders` / `shopify_products`, `app_settings`, `brand_integrations`, `integrations` (Dropbox), calendar + feature-request tables.

Prefer service-role clients only on the server. Browser uses anon key + RLS.

## Ship / ops footguns

1. **No secrets in chat, docs, commits, or screenshots.** Env + Vercel + `app_settings` only.
2. **Service role** (`SUPABASE_SERVICE_ROLE_KEY`) — Vercel/server routes only. Never ship it to the client.
3. **Browser / ops UI** — anon key + RLS. Don’t bypass RLS from the browser.
4. **Never invent** brand lists, metrics, tokens, or “looks right” spend. Query or say unknown.
5. **Google Ads** = Pipeboard (`src/lib/pipeboard-google.ts`). Normalize customer IDs with `normalizeCustomerId` (digits only). Windsor is retired.
6. **Meta token** expires; refresh manually into env / `app_settings`. Use `/api/token-health` when diagnosing.
7. **Ad Changelog** scans on demand (POST `/api/ad-changelog`). There is **no** Vercel weekly cron; operators click **Refresh Now**. First scan seeds snapshots (many `new_entity` rows); later scans emit status/budget/removed diffs. Google budgets are not returned by Pipeboard (status-only for Google).
8. Don’t expand Triple Whale onboarding or “fix the TS build” as drive-by scope unless that is the task.

## Working here

- Path alias: `@/*` → `src/*`.
- Local: `npm install` then `npm run dev` (needs env mirroring Vercel for real data).
- Cron today: `vercel.json` → `/api/cron/sync-pending` every 5 minutes (Dropbox resume), auth via `CRON_SECRET`.
- Agents: prefer this file over archived Hermes. Update **this** file when product truth changes.
