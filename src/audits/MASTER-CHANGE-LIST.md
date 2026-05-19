# Master Change List — Melch.Cloud Platform Optimization

**Compiled from:** Daily P&L Audit, Brand Settings Audit
**Date:** 2026-05-18

All findings deduplicated and ordered by priority. Each item has a unique ID for tracking.

---

## CRITICAL — Fix Immediately

| ID | Description | File(s) | Source Audit |
|----|-------------|---------|-------------|
| C1 | **Net revenue formula double-subtracts taxes.** `grossSales` is `subtotal_price + total_discounts` (no tax), but `calcFields` subtracts `row.taxes` again, understating ALL revenue, contribution, MER, and AMER metrics. **Fix:** Remove `- row.taxes` from the net revenue formula. | `daily-pnl/page.tsx:87` | P&L 1.1 |
| C2 | **NC classification silently fails when GraphQL enrichment errors.** `lifetimeOrdersCount` defaults to 0, the `0 > 0` check is false, and ALL orders become RC — massively understating new customer metrics. **Fix:** Fall back to `customer.orders_count` from the embedded Shopify object when enrichment fails. Add monitoring for enrichment failure rate. | `shopify-sync/route.ts:303-306, 488` | P&L 5.4 |
| C3 | **`toggleMonth` function called but never defined.** Would throw a ReferenceError if a month row has `isExpandable: true`. **Fix:** Remove the dead code branch or define the function. | `daily-pnl/page.tsx:2673` | P&L 7.1 |
| C4 | **Gross margin has 3 conflicting sources of truth.** Brand column (62%), per-month app_settings override, and efficiency page hardcode (65%). Same brand can show different margins across pages simultaneously. **Fix:** Centralize on `brands` table. Remove gross margin from per-month app_settings. Remove hardcoded defaults from page components. | `daily-pnl/page.tsx:1500,1641,1681`, `efficiency/page.tsx:154`, `shopify-sync/route.ts:793` | Settings 4.1 |
| C5 | **Target ROAS has 2 conflicting hardcoded defaults.** Efficiency page uses 1.2x, Ad Perspective uses 1.5x. **Fix:** Add `target_roas` and `roas_floor` columns to `brands` table. Read from brand settings on both pages. | `efficiency/page.tsx:154`, `ad-perspective/page.tsx:466` | Settings 4.2 |

---

## HIGH — Fix This Sprint

| ID | Description | File(s) | Source Audit |
|----|-------------|---------|-------------|
| H1 | **~950 lines of dead placeholder data bloating client bundle.** `DATA_2025` and `DATA_2026` are never referenced by the component. **Fix:** Delete lines 132-1079. | `daily-pnl/page.tsx:132-1079` | P&L 7.2 |
| H2 | **Add brand-level financial settings columns to `brands` table.** `target_roas`, `roas_floor`, `nc_share_pct`, `ltv_3m_mult`, `ltv_6m_mult`, `ltv_12m_mult`, `payment_processing_pct`, `returns_rate_pct`, `shipping_cost_per_order`, `creative_cost_static`, `creative_cost_video`. All with sensible defaults, all nullable. | `brands` table (Supabase) | Settings 5.1 |
| H3 | **Add "Financial Settings" sections to Team page.** Three new collapsible sections in brand settings panel: Unit Economics (margin, processing fee, returns rate), Performance Targets (target ROAS, ROAS floor, NC share), LTV Assumptions (3m/6m/12m multipliers). Plus Creative Costs (static/video). | `team/page.tsx` settings panel | Settings 5.3 |
| H4 | **Update brand-setup API to accept new fields.** Add all new columns to the `allowedFields` array. | `api/admin/brand-setup/route.ts:77-81` | Settings 5.4 |
| H5 | **Update Efficiency page to read settings from brand.** Initialize VC%, NC share, LTV multipliers, target ROAS from brand columns instead of hardcoded `DEFAULT_PARAMS`. Settings persist across sessions instead of resetting on every refresh. | `efficiency/page.tsx:154, 263` | Settings 4.5 |
| H6 | **Update Ad Perspective page to read settings from brand.** Initialize `roasFloor` from `brand.roas_floor`, creative costs from `brand.creative_cost_static/video`. | `ad-perspective/page.tsx:466-468` | Settings 5.5 |
| H7 | **NC/RC revenue uses `subtotal_price` but `grossSales` uses `subtotal_price + total_discounts`.** The proportional NC/RC split in `calcFields` doesn't reconcile. **Fix:** Store NC/RC revenue as gross sales share at sync time. | `shopify-sync/route.ts:317-332` | P&L 1.2 |
| H8 | **Off-Shopify revenue gets same COGS% applied.** The modal says "input fully loaded net revenue" but code applies COGS anyway. **Fix:** Either exclude from COGS calc or add separate margin input for off-Shopify. | `daily-pnl/page.tsx:87,96` | P&L 1.4 |
| H9 | **No data freshness indicator.** `synced_at` is stored but never shown. Users can't tell if data is stale. **Fix:** Show "Last synced: X hours ago" next to sync button. | `daily-pnl/page.tsx` UI | P&L 5.6 |
| H10 | **No error state for failed data fetch.** Console-logs error and shows empty table. **Fix:** Add error state with retry button. | `daily-pnl/page.tsx:1650-1655` | P&L 7.5 |
| H11 | **CSV exports only visible rows** (depends on view mode and expansion). **Fix:** Always export all daily rows, or add "Export All Days" option. | `daily-pnl/page.tsx:1927` | P&L 6.4 |
| H12 | **30-day sync window can miss month boundaries.** Syncing on the 2nd only goes back to the 3rd of last month. **Fix:** Default to 60 days or first-of-current-month. | `shopify-sync/route.ts:461-462` | P&L 5.2 |
| H13 | **Supabase client created on every render** (Daily P&L). **Fix:** Wrap in `useMemo`. | `daily-pnl/page.tsx:1477` | P&L 7.3 |
| H14 | **VC/COGS naming chaos.** Called `vc` (efficiency), `grossMargin` (P&L), `cod` (forecast), `grossMarginPct` (LTV cohorts). Same concept, different names, inverted semantics. **Fix:** Standardize to `gross_margin_pct` everywhere (margin%, not cost%). | Multiple pages | Settings 4.3 |
| H15 | **Column name `shopify_gross_margin_pct` is misleading.** Used for ALL revenue, not just Shopify. **Fix:** Rename to `gross_margin_pct` (after all code refs updated). | `brands` table, all consumers | Settings 4.4 |
| H16 | **Ad spend sync coupled to order sync.** Can't update just spend without re-pulling orders. **Fix:** Add separate ad-spend-sync endpoint or optional mode. | `shopify-sync/route.ts:569` | P&L 8.5 |

---

## MEDIUM — Next Sprint

| ID | Description | File(s) | Source Audit |
|----|-------------|---------|-------------|
| M1 | **COGS is a flat % — no fulfillment or payment processing costs.** **Fix:** Add `payment_processing_pct` (default 2.9%) to brand settings and deduct from contribution margin. Document what's included. | `daily-pnl/page.tsx:96` | P&L 1.3 |
| M2 | **No timezone handling for date attribution.** Shopify timestamps split at 'T' without timezone conversion. **Fix:** Convert to store timezone before extracting date. | `shopify-sync/route.ts:314` | P&L 5.3 |
| M3 | **No TikTok/Pinterest ad platform integrations.** Only Meta and Google automated. All others lumped into "Other Spend" distributed evenly. **Fix:** Add TikTok Ads API. Allow per-day "Other Spend" input. | `shopify-sync/route.ts` | P&L 8.2 |
| M4 | **Remove gross margin from per-month settings.** The per-month override creates confusion and inconsistency. If margin changes, update the brand-level setting. **Fix:** Stop reading/writing `grossMargin` from `pnl_settings` JSON. | `daily-pnl/page.tsx:1641,1681`, `pnl-settings/route.ts` | Settings 3 |
| M5 | **Default gross margin disagrees between code paths.** Five places hardcode 62%, two places hardcode 35% VC (65% margin). **Fix:** Eliminate all hardcoded defaults — always read from brand record. | Multiple files | Settings 4.6 |
| M6 | **Auto-suggest NC% from actual order data** on LTV Cohorts and Efficiency pages. Data exists in `daily_pnl` (`nc_orders`/`rc_orders`). **Fix:** Calculate and display alongside manual input. | `efficiency/page.tsx`, `ltv-cohorts/page.tsx` | Settings 2 |
| M7 | **Refunds attributed to refund date, not order date.** NC/RC revenue for the original order day is not reduced. **Fix:** Document behavior. Consider option for accrual-based attribution. | `shopify-sync/route.ts:314,341` | P&L 5.1 |

---

## LOW — Backlog / Polish

| ID | Description | File(s) | Source Audit |
|----|-------------|---------|-------------|
| L1 | **Contribution margin excludes key variable costs** (fulfillment, returns processing, CS). **Fix:** Rename to "Ad Contribution" or add disclaimer. | `daily-pnl/page.tsx:97` | P&L 1.5 |
| L2 | **No daily averages or month-end projections.** **Fix:** Add `(MTD / days elapsed) * days in month`. | `daily-pnl/page.tsx` | P&L 2.3 |
| L3 | **Missing discount rate and refund rate columns.** **Fix:** Add `Disc %` and `Refund %` calculated columns. | `daily-pnl/page.tsx` | P&L 3.2 |
| L4 | **Missing NC % column in P&L table.** Shown in metric card but not table. **Fix:** Add `NC %` column. | `daily-pnl/page.tsx` | P&L 3.3 |
| L5 | **Gross margin 62% hardcoded in 3 places.** Consistent but fragile. **Fix:** Single source of truth from API. | Multiple files | P&L 4.2 |
| L6 | **Other spend saved as string not number.** **Fix:** Parse to number before saving. | `daily-pnl/page.tsx:1674` | P&L 4.3 |
| L7 | **No settings audit trail.** Upserts overwrite with no history. **Fix:** Add `updated_by`, `updated_at` or history table. | `pnl-settings/route.ts:98-100` | P&L 4.4 |
| L8 | **No automatic/scheduled sync.** Manual only. **Fix:** Add cron job for daily sync. | `shopify-sync/route.ts` | P&L 5.7 |
| L9 | **No UTF-8 BOM for Excel CSV compatibility.** **Fix:** Add `\uFEFF` prefix. | `daily-pnl/page.tsx:1929` | P&L 6.5 |
| L10 | **No mobile-optimized view.** Table requires 1600px. Acceptable for financial reporting. | `daily-pnl/page.tsx:2553` | P&L 7.4 |
| L11 | **Brand dropdown doesn't close on outside click.** **Fix:** Add click-outside handler. | `daily-pnl/page.tsx:2085-2113` | P&L 7.6 |
| L12 | **Stale data visible during brand switch.** Old brand data shown until new loads. **Fix:** Clear data or overlay skeleton. | `daily-pnl/page.tsx` | P&L 7.8 |
| L13 | **Windsor date format not validated.** Google spend dates from Windsor API not normalized. **Fix:** Add date validation. | `shopify-sync/route.ts:591-593` | P&L 8.4 |
| L14 | **Forecast page uses `cod` instead of `gross_margin_pct`.** Inverted semantics. **Fix:** Standardize naming as part of H14. | `forecast/page.tsx:315` | Settings 4.3 |

---

## Implementation Order

### Sprint 1 — Critical Fixes + Schema Foundation
1. **C1** — Fix net revenue tax double-subtraction
2. **C3** — Fix/remove `toggleMonth` undefined
3. **C2** — Fix NC classification fallback
4. **H2** — Add new columns to `brands` table (Supabase migration)
5. **H4** — Update brand-setup API to accept new fields
6. **H1** — Remove dead placeholder data (~950 lines)
7. **H13** — Memoize Supabase client

### Sprint 2 — Centralize Settings
8. **H3** — Add Financial Settings UI to Team page
9. **C4** — Remove per-month gross margin override, centralize on brands table
10. **C5** — Move target ROAS / ROAS floor to brand settings
11. **H5** — Update Efficiency page to read from brand
12. **H6** — Update Ad Perspective page to read from brand
13. **H14** — Standardize VC/COGS naming across all pages
14. **M4** — Remove grossMargin from pnl_settings
15. **M5** — Eliminate hardcoded defaults

### Sprint 3 — Data Quality + UX
16. **H7** — Fix NC/RC revenue reconciliation in sync
17. **H8** — Fix off-Shopify COGS treatment
18. **H9** — Add data freshness indicator
19. **H10** — Add error state with retry
20. **H11** — Fix CSV to export all days
21. **H12** — Extend sync window to 60 days
22. **H15** — Rename `shopify_gross_margin_pct` → `gross_margin_pct`
23. **H16** — Decouple ad spend sync

### Sprint 4 — Enhancements + Polish
24. **M1** — Add payment processing fee deduction
25. **M2** — Timezone handling for date attribution
26. **M6** — Auto-suggest NC% from data
27. **M7** — Document refund attribution behavior
28. **L1-L14** — Backlog items as capacity allows
