# Brand Settings Architecture Audit

**Date:** 2026-05-18
**Scope:** All financial/operational settings across Melch.Cloud DTC marketing platform
**Goal:** Document current state, find conflicts, propose centralized brand-level settings on the Team page

---

## 1. CURRENT STATE MAP

### 1.1 Brand-Level Settings (stored on `brands` table)

| Setting | Column | Default | Where Set | Where Consumed | Scope |
|---------|--------|---------|-----------|----------------|-------|
| Shopify Gross Margin % | `shopify_gross_margin_pct` | `62` (schema default) | Team page settings panel (line 598-624), Onboard wizard step 1 (line 621-630) | shopify-sync GET (line 793), daily-pnl (line 1628), efficiency (line 263), ltv-cohorts (line 342), forecast (line 315), ad-perspective (line 552) | Per-brand, persistent |
| Shopify Store Domain | `shopify_store_domain` | `null` | Team page (line 509-534), Onboard step 2 (line 669-674) | shopify-sync POST (line 409) | Per-brand, persistent |
| Shopify Client ID | `shopify_client_id` | `null` | Team page (line 536-558) | shopify-sync POST (line 430) | Per-brand, persistent |
| Shopify Client Secret | `shopify_client_secret` | `null` | Team page (line 562-595) | shopify-sync POST (line 430) | Per-brand, persistent |
| Meta Ad Account ID | `meta_ad_account_id` | `null` | Team page (line 449-471), Onboard step 2 | shopify-sync POST (line 604), meta-insights API | Per-brand, persistent |
| Google Ads Customer ID | `google_ads_customer_id` | `null` | Team page (line 473-499), Onboard step 2 | shopify-sync POST (line 575) | Per-brand, persistent |
| Website URL | `website_url` | `null` | Team page (line 423-447), Onboard step 1 | Display only | Per-brand, persistent |

**File references:**
- Schema: `supabase/migration-shopify-pnl.sql` (lines 8-11)
- Team page: `src/app/team/page.tsx` (Brand interface lines 48-59, settings panel lines 416-627)
- Brand-setup API: `src/app/api/admin/brand-setup/route.ts` (allowed fields lines 77-81)
- Onboard API: `src/app/api/admin/onboard/route.ts` (create_brand lines 48-81)
- Onboard page: `src/app/admin/onboard/page.tsx` (gross margin input line 621-630)

### 1.2 Per-Month Settings (stored in `app_settings` table as JSON)

Storage key pattern: `pnl_{brand_id}_{YYYY-MM}` (e.g. `pnl_abc123_2026-05`)

| Setting | JSON key | Default (if no saved settings) | Where Set | Where Consumed | Scope |
|---------|----------|-------------------------------|-----------|----------------|-------|
| Other Spend (monthly $) | `otherSpend` | `'0'` (string) | Daily P&L settings bar (line 2162) | Daily P&L calculation (line 1760, 1811) | Per-brand, per-month |
| Other Spend Locked | `otherSpendLocked` | `false` | Daily P&L lock toggle (line 2173) | Daily P&L distribution logic (line 1811) | Per-brand, per-month |
| Off-Shopify Revenue ($) | `offShopify` | `'0'` (string) | Daily P&L settings bar (line 2197) | Daily P&L calculation (line 1765, 1819) | Per-brand, per-month |
| Off-Shopify Locked | `offShopifyLocked` | `false` | Daily P&L lock toggle (line 2208) | Daily P&L distribution logic (line 1819) | Per-brand, per-month |
| Gross Margin % (override) | `grossMargin` | Falls back to brand's `shopify_gross_margin_pct` | Daily P&L settings bar (line 2136) | Daily P&L calcFields (line 1831, 2744) | Per-brand, per-month (OVERRIDES brand default) |

**File references:**
- API: `src/app/api/pnl-settings/route.ts` (GET lines 34-72, POST lines 74-107)
- Schema: `supabase/migration-app-settings.sql` (lines 1-39)
- Consumer: `src/app/analytics/daily-pnl/page.tsx` (fetch lines 1598-1660, save lines 1662-1692)

### 1.3 Page-Local / Session-Only Settings (NOT persisted)

| Setting | Default | Page | What Happens on Refresh | File:Line |
|---------|---------|------|------------------------|-----------|
| **Efficiency Page** | | | | |
| VC % (COGS) | `35` (hardcoded), then overridden to `100 - brand.shopify_gross_margin_pct` | Efficiency | Resets to brand default | efficiency/page.tsx:154, 263 |
| NC Share % | `60` | Efficiency | Resets to 60 | efficiency/page.tsx:154 |
| LTV 3m multiplier | `1.4` | Efficiency | Resets to 1.4 | efficiency/page.tsx:154 |
| LTV 6m multiplier | `1.8` | Efficiency | Resets to 1.8 | efficiency/page.tsx:154 |
| LTV 12m multiplier | `2.5` | Efficiency | Resets to 2.5 | efficiency/page.tsx:154 |
| Recency Half-Life (days) | `60` | Efficiency | Resets to 60 | efficiency/page.tsx:154 |
| Target ROAS | `1.2` | Efficiency | Resets to 1.2 | efficiency/page.tsx:154 |
| Current Daily Spend | Auto-calculated from last 7 days | Efficiency | Re-calculated | efficiency/page.tsx:304-308 |
| Spend Mode (total/meta) | `'total'` | Efficiency | Resets to total | efficiency/page.tsx:154 |
| Date Range | `'90d'` | Efficiency | Resets to 90d | efficiency/page.tsx:154 |
| **Ad Perspective Page** | | | | |
| ROAS Floor | `1.5` | Ad Perspective | Resets to 1.5 | ad-perspective/page.tsx:466 |
| Percentile Interval | `5` | Ad Perspective | Resets to 5 | ad-perspective/page.tsx:465 |
| Static Ad Cost | `$50` | Ad Perspective | Resets to 50 | ad-perspective/page.tsx:467 |
| Video Ad Cost | `$150` | Ad Perspective | Resets to 150 | ad-perspective/page.tsx:468 |
| Include Production Cost | `false` | Ad Perspective | Resets to false | ad-perspective/page.tsx:469 |
| **Forecast Page** | | | | |
| COD % (cost of delivery) | `100 - brand.shopify_gross_margin_pct` or `35` | Forecast | Recalculated from brand | forecast/page.tsx:315 |
| Scenario (conservative/base/stretch) | `'base'` | Forecast | Resets to base | forecast/page.tsx:162 |
| Monthly Seasonality | Hardcoded defaults | Forecast | Resets to defaults | forecast/page.tsx:177 |
| **LTV Cohorts Page** | | | | |
| Gross Margin % | `brand.shopify_gross_margin_pct ?? 62` | LTV Cohorts | Recalculated from brand | ltv-cohorts/page.tsx:342 |
| **Daily P&L Page** | | | | |
| Granularity (Day/Week/Month/Quarter) | `'Day'` | Daily P&L | Resets to Day | daily-pnl/page.tsx:1510 |
| Display Mode (Absolute/Margin %) | `'Margin %'` | Daily P&L | Resets to Margin % | daily-pnl/page.tsx:1511 |
| **Campaigns Page** | | | | |
| No financial settings found | N/A | Campaigns | N/A | campaigns/page.tsx |

---

## 2. SETTINGS THAT SHOULD BE BRAND-LEVEL

These settings represent stable business characteristics that rarely change month-to-month. They should be set once on the Team page and used by all analytics pages as defaults.

| Setting | Current Location | Rationale | Recommended Column on `brands` |
|---------|-----------------|-----------|-------------------------------|
| Gross Margin % | `brands.shopify_gross_margin_pct` (already exists) | Core unit economics metric used by 5+ pages. Currently the only one that IS brand-level. | `gross_margin_pct` (rename from shopify-specific) |
| Target ROAS | Hardcoded to `1.2` in efficiency page, `1.5` in ad-perspective | Key performance benchmark. Different by brand but stable within a brand. | `target_roas` (numeric, default 1.5) |
| NC Share % (default) | Hardcoded to `60` in efficiency | Stable brand characteristic based on acquisition maturity. | `nc_share_pct` (numeric, default 60) |
| LTV Multipliers (3m, 6m, 12m) | Hardcoded to `1.4, 1.8, 2.5` in efficiency | Brand-specific repeat purchase behavior. Should be derived from data eventually but manual override needed. | `ltv_3m_mult`, `ltv_6m_mult`, `ltv_12m_mult` (numeric) |
| Payment Processing Fee % | Not tracked anywhere | Should be deducted from net revenue. Typically 2.9% + $0.30 or similar. | `payment_processing_pct` (numeric, default 2.9) |
| Shipping Cost Model | Not tracked | Affects COGS calculation. Flat per-order, % of revenue, or actual. | `shipping_cost_per_order` (numeric, nullable) |
| Returns Rate % | Not tracked | Should be factored into effective revenue. | `returns_rate_pct` (numeric, default 0) |
| Static Ad Production Cost | Hardcoded to `$50` in ad-perspective | Creative cost-til-winner calculation. Brand-specific. | `creative_cost_static` (numeric, default 50) |
| Video Ad Production Cost | Hardcoded to `$150` in ad-perspective | Creative cost-til-winner calculation. Brand-specific. | `creative_cost_video` (numeric, default 150) |
| ROAS Floor (Winner threshold) | Hardcoded to `1.5` in ad-perspective | Brand-specific profitability threshold for labeling "winning" ads. | `roas_floor` (numeric, default 1.5) |

---

## 3. SETTINGS THAT SHOULD STAY PER-MONTH

These are truly variable inputs that change month-to-month and belong in the per-month `pnl_settings` system.

| Setting | Current Storage | Rationale |
|---------|----------------|-----------|
| Other Spend Amount ($) | `app_settings` JSON | Varies by month (software costs, contractors, etc.) |
| Other Spend Locked toggle | `app_settings` JSON | Controls daily distribution for that specific month |
| Off-Shopify Revenue Amount ($) | `app_settings` JSON | Amazon/retail revenue varies month-to-month |
| Off-Shopify Locked toggle | `app_settings` JSON | Controls daily distribution for that specific month |
| **Gross Margin % override** | `app_settings` JSON (overrides brand default) | **SHOULD BE REMOVED** from per-month. If a brand's margin actually changes, update the brand-level setting. Having per-month overrides creates confusion and data inconsistency. |
| Forecast scenario inputs (spend, aMER, lift, ncShare, COD per month) | `forecast_scenarios` table | These are inherently per-month planning inputs |

---

## 4. SETTINGS CONFLICTS

### 4.1 Gross Margin % -- THREE SOURCES OF TRUTH

**Critical conflict.** The gross margin percentage has three possible values that can disagree:

1. **Brand column default:** `brands.shopify_gross_margin_pct` (e.g., 62%)
   - Set via: Team page, Onboard wizard
   - File: `team/page.tsx:598-624`, `admin/onboard/page.tsx:621-630`

2. **Per-month override in app_settings:** `pnl_{brand}_{month}.grossMargin`
   - Set via: Daily P&L settings bar save button
   - File: `daily-pnl/page.tsx:1681`, `api/pnl-settings/route.ts:84`

3. **Hardcoded fallback:** `62` in shopify-sync GET response (line 793), or `35` VC% in efficiency defaults (line 154, which means 65% gross margin)

**Conflict behavior:**
- Daily P&L loads brand default first (line 1628), then overwrites with per-month saved setting (line 1641). If a user changes margin on the Team page, existing months with saved settings WILL NOT pick up the change.
- Efficiency page computes `vc = 100 - (brand.shopify_gross_margin_pct ?? 62)` directly from the brand column (line 263), so it WILL see Team page changes but IGNORES any per-month overrides.
- LTV Cohorts reads `brand.shopify_gross_margin_pct ?? 62` directly (line 342), ignoring per-month overrides.
- Forecast reads `brand.shopify_gross_margin_pct` directly (line 315), ignoring per-month overrides.
- Ad Perspective reads `gross_margin_pct` from the shopify-sync GET response (line 552), which returns the brand column value (shopify-sync route.ts line 793).

**Result:** A user could have margin=65% on Team page, but Daily P&L for April shows 70% because someone saved that per-month override in March. Meanwhile, the efficiency page for the same brand shows 35% VC (=65% margin). The LTV page shows 65%. Three different margin values for the same brand at the same time.

### 4.2 Target ROAS -- TWO DIFFERENT HARDCODED DEFAULTS

| Page | Default | File:Line |
|------|---------|-----------|
| Efficiency | `1.2` | efficiency/page.tsx:154 (`tr: 1.2`) |
| Ad Perspective | `1.5` | ad-perspective/page.tsx:466 (`roasFloor: 1.5`) |

These serve slightly different purposes (efficiency curve breakeven vs ad winner threshold), but conceptually they represent the brand's minimum acceptable ROAS. A brand-level setting would at least provide a shared baseline.

### 4.3 VC% / COGS Naming Inconsistency

- Efficiency page calls it `vc` ("variable cost") and defaults to `35` (meaning 65% margin) -- line 154
- Daily P&L calls it `grossMargin` and defaults to `62` (meaning 38% COGS) -- line 1500
- Forecast calls it `cod` ("cost of delivery") and derives from `100 - brand.shopify_gross_margin_pct` -- line 315
- LTV Cohorts calls it `grossMarginPct` and reads brand setting -- line 342

All four represent the same concept but use different variable names and, critically, inverted semantics (margin% vs cost%). The efficiency page stores the INVERSE (cost %) while all others store margin %.

### 4.4 Column Name: `shopify_gross_margin_pct`

The column is named `shopify_gross_margin_pct` but it is used for ALL revenue calculations, not just Shopify. The LTV cohorts page, efficiency page, and forecast all apply it to total brand economics. The prefix `shopify_` is misleading and should be renamed to `gross_margin_pct`.

### 4.5 Efficiency Page Settings Are Session-Only

All eight tunable parameters on the efficiency page (VC%, NC Share, LTV multipliers, Target ROAS, Half-Life) reset on every page load. A user who carefully tunes these values for a brand loses them immediately on navigation. No save mechanism exists.

### 4.6 Default Gross Margin Disagrees Between Code Paths

| Location | Default | File:Line |
|----------|---------|-----------|
| Migration schema | `62` | migration-shopify-pnl.sql:11 |
| Onboard API | `62` | api/admin/onboard/route.ts:71 |
| Onboard page state | `'62'` | admin/onboard/page.tsx:138 |
| Daily P&L state init | `62` | daily-pnl/page.tsx:1500 |
| shopify-sync GET fallback | `62` | api/shopify-sync/route.ts:793 |
| Efficiency DEFAULT_PARAMS.vc | `35` (= 65% margin) | efficiency/page.tsx:154 |
| Forecast fallback | `35` (COD% = 65% margin) | forecast/page.tsx:315 |
| Team page init | `'62'` | team/page.tsx:280 |

**The efficiency page hardcoded default of 35% VC (65% margin) disagrees with the platform-wide 62% margin default.** This means for a brand with no `shopify_gross_margin_pct` set, the efficiency page would show 65% margin while the P&L shows 62%.

---

## 5. RECOMMENDED ARCHITECTURE

### 5.1 Schema Changes

**Option A (Recommended): Add columns to `brands` table**

```sql
-- Rename existing column
ALTER TABLE brands RENAME COLUMN shopify_gross_margin_pct TO gross_margin_pct;

-- Add new brand-level financial settings
ALTER TABLE brands
  ADD COLUMN IF NOT EXISTS target_roas numeric DEFAULT 1.5,
  ADD COLUMN IF NOT EXISTS roas_floor numeric DEFAULT 1.5,
  ADD COLUMN IF NOT EXISTS nc_share_pct numeric DEFAULT 60,
  ADD COLUMN IF NOT EXISTS ltv_3m_mult numeric DEFAULT 1.4,
  ADD COLUMN IF NOT EXISTS ltv_6m_mult numeric DEFAULT 1.8,
  ADD COLUMN IF NOT EXISTS ltv_12m_mult numeric DEFAULT 2.5,
  ADD COLUMN IF NOT EXISTS payment_processing_pct numeric DEFAULT 2.9,
  ADD COLUMN IF NOT EXISTS returns_rate_pct numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS shipping_cost_per_order numeric,
  ADD COLUMN IF NOT EXISTS creative_cost_static numeric DEFAULT 50,
  ADD COLUMN IF NOT EXISTS creative_cost_video numeric DEFAULT 150;
```

**Rationale for columns on `brands` vs a separate table:** These are scalar values with a 1:1 relationship to the brand. A separate `brand_settings` table adds an unnecessary join for every analytics query. Keep it simple.

### 5.2 Settings Read Hierarchy

Each analytics page should follow this pattern:

```
1. Read brand settings from `brands` table (single source of truth)
2. For per-month overrides (P&L only): read from `app_settings` JSON
3. For session tunables (efficiency page): initialize from brand settings, allow in-session edits
4. NEVER hardcode financial defaults in page components
```

**Remove gross margin from per-month settings.** If a brand's margin genuinely changes (e.g., new supplier), update the brand-level setting. Historical P&L calculations should use the brand setting at the time of viewing, not a frozen override.

### 5.3 Team Page UI Additions

Add a new "Financial Settings" section to the Team page `TeamCard` settings panel (currently at `team/page.tsx:416-627`). Group settings into collapsible sections:

```
[Settings Gear] > Brand Settings Panel
  |
  +-- Connections (existing)
  |     Store Domain, Client ID/Secret, Meta Ad Account, Google Ads ID
  |
  +-- Unit Economics (NEW)
  |     Gross Margin %     [62] %     <- renamed from "Shopify Gross Margin"
  |     Payment Processing [2.9] %
  |     Returns Rate       [0] %
  |     Shipping Cost/Order [$___]
  |
  +-- Performance Targets (NEW)
  |     Target ROAS        [1.5]x
  |     ROAS Floor (Winner)[1.5]x
  |     NC Share %         [60] %
  |
  +-- LTV Assumptions (NEW)
  |     3-Month LTV Mult   [1.4]x
  |     6-Month LTV Mult   [1.8]x
  |     12-Month LTV Mult  [2.5]x
  |
  +-- Creative Costs (NEW)
        Static Ad Cost     [$50]
        Video Ad Cost      [$150]
```

### 5.4 API Endpoint Design

**Option A: Extend existing `brand-setup` API**

Update `src/app/api/admin/brand-setup/route.ts` to add new fields to the `allowedFields` array (line 77-81):

```typescript
const allowedFields = [
  // Existing
  'google_ads_customer_id', 'meta_ad_account_id', 'website_url',
  'shopify_store_domain', 'shopify_client_id', 'shopify_client_secret',
  // Renamed
  'gross_margin_pct',
  // New
  'target_roas', 'roas_floor', 'nc_share_pct',
  'ltv_3m_mult', 'ltv_6m_mult', 'ltv_12m_mult',
  'payment_processing_pct', 'returns_rate_pct', 'shipping_cost_per_order',
  'creative_cost_static', 'creative_cost_video',
];
```

**Option B: New dedicated endpoint** `/api/brand-settings`

A GET endpoint that returns all financial settings for a brand, used by every analytics page:

```typescript
// GET /api/brand-settings?brand_id=xyz
// Returns: {
//   gross_margin_pct: 62,
//   target_roas: 1.5,
//   roas_floor: 1.5,
//   nc_share_pct: 60,
//   ltv_3m_mult: 1.4,
//   ltv_6m_mult: 1.8,
//   ltv_12m_mult: 2.5,
//   payment_processing_pct: 2.9,
//   returns_rate_pct: 0,
//   shipping_cost_per_order: null,
//   creative_cost_static: 50,
//   creative_cost_video: 150,
// }
```

Recommendation: **Option A** for writes (reuse existing admin endpoint), plus a lightweight **GET-only endpoint** or include settings in the existing `shopify-sync` GET response (which already returns `gross_margin_pct`).

### 5.5 How Each Page Should READ Settings

| Page | Current Approach | Proposed Approach |
|------|-----------------|-------------------|
| **Daily P&L** | Reads `gross_margin_pct` from shopify-sync GET, then overrides with per-month app_settings | Read `gross_margin_pct` from brand row. REMOVE margin from per-month settings. Keep other per-month settings (otherSpend, offShopify). |
| **Efficiency** | Hardcodes `DEFAULT_PARAMS` with `vc: 35`, overrides vc from brand column | Initialize ALL params from brand settings (gross_margin, target_roas, nc_share, ltv multipliers). Add save button to persist edits back to brand. |
| **Ad Perspective** | Hardcodes `roasFloor: 1.5`, reads margin from shopify-sync GET | Read `roas_floor`, `gross_margin_pct`, `creative_cost_static`, `creative_cost_video` from brand settings. |
| **LTV Cohorts** | Reads `shopify_gross_margin_pct` from brand select query | Reads `gross_margin_pct` (rename). No changes to behavior, just column name. |
| **Forecast** | Reads `shopify_gross_margin_pct`, derives COD% | Reads `gross_margin_pct` (rename). Could also read `target_roas` for aMER defaults. |
| **Campaigns** | No financial settings | No change needed. |

---

## 6. MIGRATION PLAN

### Phase 1: Schema Changes (non-breaking)

1. **Add new columns with defaults** to `brands` table:
   ```sql
   ALTER TABLE brands
     ADD COLUMN IF NOT EXISTS target_roas numeric DEFAULT 1.5,
     ADD COLUMN IF NOT EXISTS roas_floor numeric DEFAULT 1.5,
     ADD COLUMN IF NOT EXISTS nc_share_pct numeric DEFAULT 60,
     ADD COLUMN IF NOT EXISTS ltv_3m_mult numeric DEFAULT 1.4,
     ADD COLUMN IF NOT EXISTS ltv_6m_mult numeric DEFAULT 1.8,
     ADD COLUMN IF NOT EXISTS ltv_12m_mult numeric DEFAULT 2.5,
     ADD COLUMN IF NOT EXISTS payment_processing_pct numeric DEFAULT 2.9,
     ADD COLUMN IF NOT EXISTS returns_rate_pct numeric DEFAULT 0,
     ADD COLUMN IF NOT EXISTS shipping_cost_per_order numeric,
     ADD COLUMN IF NOT EXISTS creative_cost_static numeric DEFAULT 50,
     ADD COLUMN IF NOT EXISTS creative_cost_video numeric DEFAULT 150;
   ```

2. **Create alias view** for backwards compat during transition:
   ```sql
   -- Temporary: make old name still work in queries
   -- (Actually not needed — just update code references)
   ```

3. **Do NOT rename `shopify_gross_margin_pct` yet.** Wait until all code references are updated.

### Phase 2: Update brand-setup API (5 min)

1. Update `src/app/api/admin/brand-setup/route.ts` line 77-81 to add new fields to `allowedFields`.
2. Update `src/app/api/admin/onboard/route.ts` line 71 to add defaults for new fields when creating a brand.

### Phase 3: Update Team Page (30 min)

1. Update `Brand` interface in `src/app/team/page.tsx` lines 48-59 to include new fields.
2. Update `fetchData` query (line 1361) to select new columns.
3. Add "Financial Settings" section to `TeamCard` settings panel (after line 627).
4. Add state variables and save handlers for each new field.

### Phase 4: Update Analytics Pages (page by page)

**Order: Start with pages that have the most settings conflicts.**

#### 4a. Daily P&L (`src/app/analytics/daily-pnl/page.tsx`)
- Remove `grossMargin` from saved per-month settings (line 1681).
- Remove gross margin override loading from settings (line 1641).
- Keep reading brand-level margin from shopify-sync GET (line 1628) — this already works correctly.
- **Backwards compat:** If `settingsData.settings.grossMargin` exists in old saved settings, ignore it (don't apply). No data migration needed — just stop reading/writing that field.

#### 4b. Efficiency Page (`src/app/analytics/efficiency/page.tsx`)
- Update brand select query (line 239) to include all new columns.
- Replace `DEFAULT_PARAMS` hardcoded values (line 154) with brand-derived values:
  ```typescript
  const brandDefaults = (brand: Brand): Params => ({
    vc: 100 - (brand.gross_margin_pct ?? 62),
    nc: brand.nc_share_pct ?? 60,
    l3: brand.ltv_3m_mult ?? 1.4,
    l6: brand.ltv_6m_mult ?? 1.8,
    l12: brand.ltv_12m_mult ?? 2.5,
    hl: 60,  // Keep as session-only, no brand-level equivalent
    tr: brand.target_roas ?? 1.5,
    curSpend: 1200,  // Auto-calculated from data
    spendMode: 'total',
    dateRange: '90d',
  });
  ```
- Update brand-switch effect (line 262-264) to use new function.
- **Optional:** Add "Save to Brand" button that writes tuned params back to the brand.

#### 4c. Ad Perspective Page (`src/app/analytics/ad-perspective/page.tsx`)
- Fetch brand settings when account is selected (brand_id is already available from accounts, line 536).
- Initialize `roasFloor` from `brand.roas_floor ?? 1.5` (line 466).
- Initialize `staticCost` from `brand.creative_cost_static ?? 50` (line 467).
- Initialize `videoCost` from `brand.creative_cost_video ?? 150` (line 468).
- Use `gross_margin_pct` from shopify-sync GET (already done, line 552).

#### 4d. Forecast Page (`src/app/analytics/forecast/page.tsx`)
- Update brand select query (line 202) to include `target_roas`.
- Use `brand.target_roas` as default aMER target in scenario initialization (line 315-371).
- Column rename: `shopify_gross_margin_pct` -> `gross_margin_pct`.

#### 4e. LTV Cohorts Page (`src/app/analytics/ltv-cohorts/page.tsx`)
- Update brand select query (line 282) to use `gross_margin_pct` instead of `shopify_gross_margin_pct`.
- Update all references to `shopify_gross_margin_pct` (lines 342, 365, 381, 429, 481, 576).

### Phase 5: Column Rename (after all code updated)

```sql
ALTER TABLE brands RENAME COLUMN shopify_gross_margin_pct TO gross_margin_pct;
```

This is a **breaking change** — all code references must be updated first (Phase 4a-4e).

### Phase 6: Data Migration from app_settings

No data migration is strictly needed for the `app_settings` table because:
- The `grossMargin` field in per-month settings will simply be ignored (Phase 4a).
- All other per-month fields (`otherSpend`, `offShopify`, locks) stay in app_settings as-is.
- Old saved settings with `grossMargin` will harmlessly persist but never be read.

**Optional cleanup** (can be done anytime after Phase 4a):
```sql
-- View which months have gross margin overrides
SELECT key, value::jsonb->'grossMargin' as margin_override
FROM app_settings
WHERE key LIKE 'pnl_%'
  AND value::jsonb->>'grossMargin' IS NOT NULL;
```

### Phase 7: Update shopify-sync GET Response

Update `src/app/api/shopify-sync/route.ts` (line 774-793):
- Change `shopify_gross_margin_pct` to `gross_margin_pct` in the select query.
- Consider adding all brand financial settings to the response payload so consuming pages don't need separate fetches.

### Backwards Compatibility Summary

| Change | Breaking? | Migration Required? |
|--------|-----------|-------------------|
| New columns on brands | No — all have defaults | No |
| Stop writing grossMargin to app_settings | No — old data harmlessly ignored | No |
| Stop reading grossMargin from app_settings | Behavior change — margin no longer varies by month | Document to users |
| Rename shopify_gross_margin_pct column | Yes — all SELECT queries break | Update all code first |
| New Team page UI sections | No — additive | No |
| Efficiency page reads brand defaults | Behavior change — settings persist | Better UX |
| Ad perspective reads brand defaults | Behavior change — settings persist | Better UX |

---

## APPENDIX: File Index

| File | Role |
|------|------|
| `src/app/team/page.tsx` | Team/brand management UI — settings panel for brand config |
| `src/app/admin/onboard/page.tsx` | Client onboarding wizard — sets initial brand config |
| `src/app/api/admin/brand-setup/route.ts` | API for updating brand fields |
| `src/app/api/admin/onboard/route.ts` | API for onboarding actions (create brand, set integrations, etc.) |
| `src/app/api/pnl-settings/route.ts` | API for per-month P&L settings (app_settings table) |
| `src/app/api/shopify-sync/route.ts` | Shopify order sync + P&L data GET endpoint |
| `src/app/analytics/daily-pnl/page.tsx` | Daily P&L page — primary settings consumer, ~2800 lines |
| `src/app/analytics/efficiency/page.tsx` | Marginal efficiency curve — Hill model with 8 tunable params |
| `src/app/analytics/ad-perspective/page.tsx` | Meta ad analysis — ROAS floor, creative costs |
| `src/app/analytics/ltv-cohorts/page.tsx` | LTV cohort analysis — uses gross margin for GP calculations |
| `src/app/analytics/forecast/page.tsx` | Revenue/spend forecasting — uses COD% from brand margin |
| `src/app/analytics/campaigns/page.tsx` | Campaign performance — no financial settings |
| `supabase/migration-shopify-pnl.sql` | Schema for brands Shopify columns + daily_pnl table |
| `supabase/migration-app-settings.sql` | Schema for app_settings key-value table |
