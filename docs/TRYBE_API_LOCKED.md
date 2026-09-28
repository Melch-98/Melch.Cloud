# Trybe Brand API — locked from Mintier live probe (2026-09-15)

Base: `https://api.jointrybe.com`
Auth: `Authorization: Bearer tk_live_…` (per-brand key from Integrations → API Access)
Money: integer **cents**
Pagination: `{ object, data, has_more, next_cursor, previous_cursor }` — pass `after` / `before` (and `limit` ≤ 100)

## Working endpoints

### GET /v1/creators
List active creators. Fields: `id` (`creator_<uuid>`), `name`, `avatar_url`, `joined_at`

### GET /v1/submissions
Query: `status` ∈ `pending|approved|rejected|revision_requested`, `limit`, `after`/`before`, optional `creator_id` / `program_id`
Item fields (live): `id`, `trybe_id`, `creator{id,name}`, `status`, `media_type` (`video|image`), `version`, `revision_of`, `program{id,name}`, `ads{count,first_day,last_day}`, `group`, `products[]`, `creator_comment`, `review_comment`, `transcript`, `angles[]`, `asset{url,expires_at}`, `thumbnail_url`, `created_at`

### GET /v1/submissions/{id}
Same shape as list item. Asset URLs are short-lived signed URLs.

### GET /v1/creator-performance
**Rules:** `end_date` must be on or before **yesterday UTC** (complete days only). With metric `sort_by` or `active_only`, window capped at **90 days**.
Query: `start_date`, `end_date`, `limit`, `after`/`before`, `active_only`, `sort_by` ∈ `joined_at|earnings|trybe_gmv|trybe_conversions|new_submissions|active_submissions|ads|spend|purchase_value|purchases`
Row: `creator{id,name,avatar_url,joined_at}`, `programs[{id,name}]`, `activity{last_submission_at,last_ad_day}`, `performance{start_date,end_date,currency,earnings_cents,trybe_conversions,trybe_gmv_cents,new_submissions,active_submissions,ads,spend_cents,purchases,purchase_value_cents,roas}`

## Not found (404)
`/v1/ad-submissions`, `/v1/orders`, `/v2/submissions`, `/v1/creators-performance`, `/v1/performance/creators`

## Mintier fixture IDs (non-secret)
- Trybe brand uuid (CDN path): `3f31b6c8-1012-4044-a8a0-8581fae090a9`
- Program: `creator_program_c4cb5956-3eb0-4d70-b622-2d360b67c764` — name `10% Ad Spend`

## Melch.Cloud product mapping (Alysha / Winks 3 tabs)
1. **Program overview** — aggregate `/v1/submissions` by day + status + media_type (pipeline + format mix + volume)
2. **Creator leaderboard** — `/v1/creator-performance?sort_by=spend&active_only=true` (or earnings)
3. **Top ads by spend** — Trybe submissions only expose `ads.count` / date range, **not per-ad spend**. Cards are **one creative per `trybe_id`** (dedupe asset/thumb fallback). Join Melch Meta ad insights when `ad_name` contains `trybe=<trybe_id>` — sum spend/impressions/purchases across campaign copies of the same creative. Do not invent spend; show n/a until Meta join.

## Melch constraints
- All Melch.Cloud brands except FOND; exclude `archived_at`
- Store **per-brand** Trybe API key (encrypted like other brand creds) + optional `trybe_brand_id` / `trybe_program_id`
- v1 **read-only** (no approve/reject POSTs from Melch)
- Nick is non-coder-friendly founder — keep UI clear
