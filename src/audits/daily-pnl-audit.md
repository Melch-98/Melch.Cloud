# Daily P&L Page — Comprehensive Audit Report

**Auditor:** Claude Opus 4.6  
**Date:** 2026-05-18  
**Files Reviewed:**
- `src/app/analytics/daily-pnl/page.tsx` (2825 lines)
- `src/app/api/shopify-sync/route.ts` (807 lines)
- `src/app/api/pnl-settings/route.ts` (108 lines)
- `supabase/migration-shopify-pnl.sql` (85 lines)

---

## 1. P&L Calculation Accuracy

### 1.1 Net Revenue Formula — Taxes Subtracted, Potentially Double-Counted
**Severity: Critical**  
**File:** `page.tsx:87`  
**Code:** `const netRevenue = row.grossSales + row.discounts + row.refunds - row.taxes + row.shipping + row.offShopifyRevenue;`

The formula subtracts taxes from net revenue. This is unusual for a DTC P&L — taxes are typically pass-through and not part of revenue at all. If `grossSales` already excludes tax (which is likely since `grossSales = subtotal_price + total_discounts` in the sync route, line 317), then subtracting taxes again would **understate net revenue** by the full tax amount. However, looking at the sync route more carefully, `grossSales` is indeed `subtotal_price + total_discounts` (line 317), which does NOT include tax. So subtracting taxes here **double-counts the tax deduction** and significantly understates revenue.

**Recommendation:** Remove `- row.taxes` from the net revenue formula. Taxes are collected and remitted — they are not revenue and are not included in grossSales. If you want to show taxes as a line item for transparency, keep it in the table but exclude it from the net revenue calculation. If the intent is to show "cash collected minus tax liability," rename the metric to avoid confusion.

### 1.2 NC/RC Revenue Uses subtotal_price, Not Net Revenue
**Severity: Medium**  
**File:** `shopify-sync/route.ts:321-332`  
**Code:** `const orderTotal = parseFloat(order.subtotal_price);`

NC and RC revenue are stored as `subtotal_price` (line items only, no discounts, no shipping, no tax). But `grossSales` is `subtotal_price + total_discounts` (line 317). This means `ncRevenue + rcRevenue` does NOT equal `grossSales` — the proportional allocation in `calcFields` (lines 90-93) will produce NC/RC net revenue splits that don't cleanly map back to actuals.

**Recommendation:** Store NC/RC revenue as the gross sales share (subtotal + discount portion) so the proportional split in `calcFields` is accurate. Alternatively, attribute discounts per-order at sync time.

### 1.3 COGS Is a Single Flat Percentage
**Severity: Medium**  
**File:** `page.tsx:96`  
**Code:** `const cogs = netRevenue * (1 - grossMarginPct / 100);`

COGS is computed as a flat percentage of net revenue. This is an acceptable simplification for early-stage DTC but has limitations:
- No per-SKU or per-product COGS
- No separate treatment of shipping costs as a cost line (shipping is counted as revenue, but shipping costs to fulfill are not deducted)
- No payment processing fees (typically 2.9% + $0.30 per transaction)
- COGS is applied to off-Shopify revenue too, which may have very different margins

**Recommendation:** Document that contribution margin excludes payment processing fees and fulfillment costs. Consider adding a "Variable Costs" line item for payment processing (~3% of gross) and fulfillment. At minimum, add a tooltip explaining what COGS includes.

### 1.4 Off-Shopify Revenue Gets COGS Applied Identically
**Severity: Medium**  
**File:** `page.tsx:87,96`

Off-Shopify revenue (Amazon, Retail) is added to net revenue and then the same COGS % is applied. But Amazon takes ~15% referral fee + FBA fees, so the margin profile is fundamentally different. The Off-Shopify breakdown modal says "Input fully loaded net revenue (after fees, COGS, etc.)" but the code still applies COGS to it.

**Recommendation:** Either (a) exclude offShopifyRevenue from the COGS calculation (treat it as already-net contribution), or (b) add a separate margin % input for off-Shopify channels.

### 1.5 Contribution Margin Excludes Key Variable Costs
**Severity: Low**  
**File:** `page.tsx:97`

Contribution = Net Revenue - COGS - Ad Spend. Missing:
- Payment processing fees (~3% of revenue)
- Outbound shipping/fulfillment costs
- Returns processing costs
- Customer service costs

This is acceptable for a first version if clearly labeled "Contribution Margin 1" or "Ad Contribution."

**Recommendation:** Rename to "Ad Contribution" or add a disclaimer that this is pre-variable-cost contribution.

---

## 2. Data Aggregation (buildYearData)

### 2.1 ISO Week Boundary — Weeks Split Across Months Are Duplicated
**Severity: Medium**  
**File:** `page.tsx:1150-1156`

Weeks spanning month boundaries appear in BOTH months. For example, if Week 14 has days in both March and April, the March view shows Week 14 with only the March days, and April shows Week 14 with only April days. The week summary will only sum the days within that month, which is correct behavior. However, the same week number appears in two months with different totals, which could confuse users.

The hardcoded placeholder data (lines 138-160) shows this pattern explicitly: `Wk 14 (Apr 1 - Apr 4)` in April and `Wk 14 (Mar 30 - Mar 31)` in March. This is acceptable and well-handled.

**Recommendation:** No code change needed, but consider a visual indicator (e.g., "(partial)" suffix) for split weeks.

### 2.2 YTD Aggregation Sums All Rows Correctly
**Severity: None (verified correct)**  
**File:** `page.tsx:1189`

`sumRows(rows)` iterates all input rows for the year. Weekly and monthly sums are computed independently via `sumRows(monthRows)` and `sumRows(weekRows)`. This guarantees that monthly totals = sum of days, and YTD = sum of all days. Verified correct.

### 2.3 Averages — Not Computed
**Severity: Low**  
**File:** `page.tsx` (entire file)

There are no daily averages shown (e.g., avg daily revenue, avg daily spend). For MTD reporting, showing "avg per day" alongside totals would help users project month-end numbers.

**Recommendation:** Add projected month-end estimates: `(MTD total / days elapsed) * days in month`.

---

## 3. DTC-Specific P&L Line Items

### 3.1 Core Line Items Present
The table includes all essential DTC P&L metrics:
- NC Orders, NC Revenue, RC Orders, RC Revenue
- Gross Sales, Discounts, Refunds, Taxes, Shipping
- Off-Shopify Revenue, Net Revenue
- Meta Spend, Google Spend, Other Spend, Total Spend
- COGS, Contribution, Margin %
- NC AOV, CAC, AMER, Blended MER

### 3.2 Missing: Discount Rate and Refund Rate
**Severity: Low**  
**File:** `page.tsx` (table columns)

No discount rate (discounts / gross sales) or refund rate (refunds / gross sales) columns. These are important DTC health metrics.

**Recommendation:** Add `Disc %` and `Refund %` calculated columns.

### 3.3 Missing: NC Revenue % Split
**Severity: Low**  
**File:** `page.tsx` (table columns)

NC % of total revenue is shown in the metric card breakdown but not in the table rows. This is a critical DTC metric for understanding customer acquisition mix day-over-day.

**Recommendation:** Add `NC %` column to the table.

---

## 4. Settings & Configurability

### 4.1 Settings Are Per-Brand, Per-Month — Well Designed
**Severity: None (verified correct)**  
**File:** `pnl-settings/route.ts:13-15`

Settings key: `pnl_{brandId}_{month}`. This allows different gross margins, other spend, and off-Shopify revenue per brand per month. Correct.

### 4.2 Gross Margin Defaults to 62% — Hardcoded Fallback
**Severity: Low**  
**File:** `shopify-sync/route.ts:793`, `page.tsx:1500`, `migration-shopify-pnl.sql:12`

Default 62% gross margin is hardcoded in three places. The migration sets a column default, the GET handler falls back to 62, and the page state initializes to 62. This is consistent but should be a single source of truth.

**Recommendation:** Remove the hardcoded default from page.tsx and always rely on the API response (which already has the fallback chain: saved settings > brand default > 62%).

### 4.3 Other Spend Saved as String, Not Number
**Severity: Low**  
**File:** `page.tsx:1674`  
**Code:** `otherSpend: otherSpendAmount` (saved as string from state)

The `otherSpendAmount` state is a string (line 1502). It's saved to the API as a string value. When loaded back (line 1637), it's also read as a string. The parseInt at line 1760 handles this, but storing as a proper number would be cleaner and avoid edge cases with non-numeric input.

**Recommendation:** Parse to number before saving: `otherSpend: parseInt(otherSpendAmount.replace(/,/g, ''), 10) || 0`.

### 4.4 No Historical Settings / Audit Trail
**Severity: Low**  
**File:** `pnl-settings/route.ts:98-100`

Settings are upserted — previous values are overwritten with no history. For financial reporting, having an audit trail of who changed what and when would be valuable.

**Recommendation:** Add `updated_by` and `updated_at` columns, or use a separate history table.

---

## 5. Shopify Data Sync

### 5.1 Date Attribution Uses created_at (Order Date), Refunds Use Refund Date
**Severity: Medium**  
**File:** `shopify-sync/route.ts:314,341`

Orders are attributed to `created_at` date (line 314), while refunds are attributed to `refund.created_at` date (line 341). This is a deliberate and documented choice. However, it means:
- A day's refund total may include refunds for orders placed on different days
- NC/RC revenue for the original order day is NOT reduced when a refund happens later
- This creates a systematic upward bias in daily revenue and a separate negative refund line

This is actually reasonable for DTC — it matches how cash flow works. But the NC/RC revenue split will be inaccurate because the refunded revenue stays attributed to the original NC/RC bucket.

**Recommendation:** Document this behavior clearly. Consider an option to attribute refunds back to original order date for accrual-based reporting.

### 5.2 Sync Window Defaults to 30 Days — Misses Start-of-Month
**Severity: Medium**  
**File:** `shopify-sync/route.ts:461-462`

Default sync window is last 30 days. If today is the 31st, this covers the full month. But if you sync on the 2nd of the month, you only get 30 days back (missing the 2nd of the previous month). More critically, if the user hasn't synced in 31+ days, they'll have a gap.

**Recommendation:** Default to `since: first day of current month` or `since: 60 days ago` to ensure full month coverage. Also add a "full re-sync" option.

### 5.3 No Timezone Handling — Uses ISO String Split
**Severity: Medium**  
**File:** `shopify-sync/route.ts:314`  
**Code:** `const dateStr = order.created_at.split('T')[0];`

Orders are assigned to a date by splitting the ISO timestamp at 'T'. Shopify returns timestamps in the store's timezone. If the store timezone is PST and an order comes in at 11pm PST (which is the next day in UTC), it will be correctly attributed to the PST date. However, if the store timezone setting changes, historical data could be inconsistent.

**Recommendation:** Explicitly convert to the store's timezone before extracting the date. Store the timezone with each sync batch.

### 5.4 NC Classification Logic Has a Subtle Bug
**Severity: Critical**  
**File:** `shopify-sync/route.ts:303-306`  
**Code:**
```javascript
const lifetimeCount = (custOrds[0] as ...).lifetimeOrdersCount ?? 0;
if (lifetimeCount > 0 && lifetimeCount <= custOrds.length) {
  firstOrderIds.add(custOrds[0].id);
}
```

The NC classification logic: if a customer's lifetime order count <= number of orders in this sync window, their first order in the window is marked NC. But this is backwards for many cases:
- If `lifetimeCount == 0` (fallback from failed enrichment), `0 > 0` is false, so NO orders get marked NC. This means if the GraphQL enrichment fails (line 488 catches and continues), ALL customers become RC.
- If a customer has 5 lifetime orders and 3 are in the window, `5 <= 3` is false, so all 3 are RC. Correct.
- If a customer has 1 lifetime order and 1 is in the window, `1 <= 1` is true, so it's NC. Correct.
- If enrichment fails for all customers, ALL orders become RC, which massively understates NC revenue.

**Recommendation:** When `lifetimeOrdersCount` is 0 or undefined (enrichment failed), fall back to treating the customer's first order in the window as NC if `customer.orders_count == 1` (the embedded Shopify value, even if sometimes unreliable). Also add monitoring/alerting when enrichment fails.

### 5.5 Ad Spend Upsert May Overwrite Shopify Data with NULLs
**Severity: Critical**  
**File:** `shopify-sync/route.ts:638-645`

The ad spend upsert creates rows with only `brand_id`, `date`, and `google_spend`/`meta_spend`. If a date has ad spend but NO Shopify orders (e.g., ads ran on a day before the store had sales), this creates a daily_pnl row with NULL/0 for all Shopify fields. If the Shopify upsert already ran for that date, the ad spend upsert could overwrite the Shopify values with defaults.

Looking more carefully: the upsert uses `onConflict: 'brand_id,date'` — Supabase's upsert with partial columns should only update the specified columns, leaving others unchanged. So this is actually safe IF the PostgreSQL upsert behavior preserves unspecified columns. With Supabase's JS client, `upsert` generates an `INSERT ... ON CONFLICT ... DO UPDATE SET` with only the provided columns. **This is correct.**

**Revised Severity: None (verified safe)** — Partial upsert preserves existing columns.

### 5.6 No Data Freshness Indicator
**Severity: Medium**  
**File:** `page.tsx` (UI)

The `synced_at` timestamp is stored in daily_pnl but never displayed to the user. The user has no way to know how stale the data is.

**Recommendation:** Show "Last synced: X minutes ago" next to the sync button. Query the max `synced_at` from daily_pnl for the current brand.

### 5.7 No Automatic/Scheduled Sync
**Severity: Low**  
**File:** `shopify-sync/route.ts`

Sync is only triggered manually. For a financial reporting tool, stale data is a major UX problem.

**Recommendation:** Add a cron job (Supabase Edge Function or Vercel cron) that syncs all active brands daily.

---

## 6. CSV Export

### 6.1 Export Includes All Columns — Verified Complete
**Severity: None (verified correct)**  
**File:** `page.tsx:1904-1936`

All 23 columns are exported: Date, NC Orders, NC Revenue, RC Orders, RC Revenue, Gross Sales, Discounts, Refunds, Taxes, Shipping, Off-Shopify, Net Revenue, Meta, Google, Other, Total Spend, COGS, Contribution, Margin %, NC AOV, CAC, AMER, MER.

### 6.2 CSV Values Properly Quoted
**Severity: None (verified correct)**  
**File:** `page.tsx:1928`  
Each cell is wrapped in double quotes. This handles commas in currency values correctly.

### 6.3 CSV Filename Includes Brand and Month
**Severity: None (verified correct)**  
**File:** `page.tsx:1934`  
Filename format: `{brand-slug}-pnl-{month}-{year}.csv`

### 6.4 CSV Exports Only Visible Rows
**Severity: Medium**  
**File:** `page.tsx:1927`  
**Code:** `const csvRows = [headers, ...tableRows.map(csvCalcRow)];`

The export includes only the currently visible `tableRows`, which depends on granularity (Day vs Week) and which weeks are expanded. If a user exports in Week view, they get MTD + weekly summaries only — no daily data.

**Recommendation:** Always export all days regardless of current view, or add a "Export All Days" option.

### 6.5 No BOM for Excel Compatibility
**Severity: Low**  
**File:** `page.tsx:1929`

No UTF-8 BOM is prepended. Some Excel installations may not correctly detect UTF-8 encoding, especially with currency symbols.

**Recommendation:** Add `\uFEFF` at the start of csvContent: `const csvContent = '\uFEFF' + csvRows.map(...)`.

---

## 7. UX & Performance

### 7.1 Undefined Function: toggleMonth
**Severity: Critical (Runtime Error)**  
**File:** `page.tsx:2673`  
**Code:** `toggleMonth(row.monthIdx);`

`toggleMonth` is called but **never defined** anywhere in the file. `toggleWeek` is defined at line 1522, but `toggleMonth` does not exist. Since the current view is MTD-only (no month-level collapse), this code path may not execute in the current UI, but it will throw a `ReferenceError` if a month row ever has `isExpandable: true`.

**Recommendation:** Either define `toggleMonth` or remove the dead code branch. Since the current view only shows one month, the month-level toggle is unnecessary.

### 7.2 Hardcoded Placeholder Data (700+ Lines)
**Severity: Medium**  
**File:** `page.tsx:132-1079`

~950 lines of hardcoded 2025-2026 placeholder data (`DATA_2025`, `DATA_2026`) exist in the component file but are **never referenced** in the component. The component only uses `liveData` from the API (line 1780). This is dead code.

**Recommendation:** Remove `DATA_2025` and `DATA_2026` entirely. They bloat the client bundle by ~30KB+ uncompressed.

### 7.3 Supabase Client Created on Every Render
**Severity: Medium**  
**File:** `page.tsx:1477`  
**Code:** `const supabase = createClient();`

`createClient()` is called directly in the component body (not in a useMemo or useRef). Depending on the implementation, this may create a new client instance on every render.

**Recommendation:** Wrap in `useMemo` or use a singleton pattern: `const supabase = useMemo(() => createClient(), []);`

### 7.4 Table Has minWidth: 1600px — No Mobile Support
**Severity: Low**  
**File:** `page.tsx:2553`

The table requires 1600px minimum width. On mobile, this requires horizontal scrolling. This is acceptable for a financial reporting table but should be noted.

**Recommendation:** For mobile, consider a card-based view showing key metrics only (Net Revenue, Spend, Contribution per day).

### 7.5 No Error State for Failed Data Fetch
**Severity: Medium**  
**File:** `page.tsx:1650-1655`

When the data fetch fails, the catch block logs to console and sets `liveData = null`. The user sees an empty table with no explanation. No error toast, banner, or retry prompt.

**Recommendation:** Add an error state variable and render an error banner with a retry button.

### 7.6 Brand Dropdown Doesn't Close on Outside Click
**Severity: Low**  
**File:** `page.tsx:2085-2113`

The brand dropdown opens on button click but only closes when a brand is selected or the button is clicked again. Clicking outside the dropdown does not close it.

**Recommendation:** Add a click-outside handler or use a portal with backdrop.

### 7.7 Memoization — tableRows Is Well-Memoized
**Severity: None (verified correct)**  
**File:** `page.tsx:1843-1898`

`tableRows` uses `useMemo` with appropriate dependencies. `currentMonthData` is also memoized. The `calcFields` function is called per-row during render but is lightweight (arithmetic only). No performance concerns.

### 7.8 Loading State Only Shows Initial Auth Load
**Severity: Low**  
**File:** `page.tsx:1946-1959`

The full-page spinner only shows during initial auth check. When switching brands or fetching data, a small spinner appears (line 2064) but the table shows stale data from the previous brand until the new data loads.

**Recommendation:** Show a skeleton or overlay on the table during brand switches to prevent showing wrong-brand data.

---

## 8. Cross-Platform Spend Reconciliation

### 8.1 Ad Spend Sources — Meta + Google + Manual "Other"
**Severity: Low**  
**File:** `shopify-sync/route.ts:569-648`

- **Meta**: Fetched from Facebook Marketing API via `/insights` endpoint with `time_increment=1` (daily). Uses `spend` field. Date is `date_start`.
- **Google**: Fetched from Windsor.ai API. Uses `spend` field. Date from `r.date`.
- **Other**: Manual monthly input, distributed evenly across calendar days.

### 8.2 No TikTok, Pinterest, or Other Ad Platforms
**Severity: Medium**  
**File:** `shopify-sync/route.ts`

Only Meta and Google are automated. TikTok, Pinterest, Snapchat, influencer spend, and other channels are lumped into "Other Spend" which is a single monthly number distributed evenly. This means:
- No daily granularity for non-Meta/Google spend
- Can't analyze TikTok ROAS separately
- Even distribution doesn't reflect actual spend patterns (weekends vs weekdays)

**Recommendation:** Add TikTok Ads API integration. Allow "Other Spend" to be input per-day or at least per-week.

### 8.3 Meta Spend Date = date_start (Impression Date)
**Severity: Low**  
**File:** `shopify-sync/route.ts:613`

Meta's `date_start` with `time_increment=1` represents the impression date, not the billing date. This is the correct choice for DTC P&L (matches when the ad ran, not when you were invoiced).

### 8.4 Google Spend Date — Windsor API Format Unknown
**Severity: Low**  
**File:** `shopify-sync/route.ts:591-593`

Google spend comes from Windsor.ai. The date format and timezone handling of Windsor's `date` field is not validated. If Windsor returns dates in a different format or timezone than expected, spend could be attributed to wrong days.

**Recommendation:** Add date format validation/normalization for Windsor API responses.

### 8.5 Ad Spend Sync Only Runs During Order Sync
**Severity: Medium**  
**File:** `shopify-sync/route.ts:569`

Ad spend is fetched as part of the Shopify order sync POST handler. If you want to update just ad spend without re-pulling orders, you can't. Also, the ad spend date range is tied to the order sync date range.

**Recommendation:** Add a separate `/api/ad-spend-sync` endpoint or allow the sync to optionally skip orders and only update spend.

---

## Summary of Findings

| # | Finding | Severity | File:Line |
|---|---------|----------|-----------|
| 1.1 | Taxes double-subtracted from net revenue | Critical | page.tsx:87 |
| 5.4 | NC classification fails silently when enrichment fails | Critical | route.ts:303-306 |
| 7.1 | `toggleMonth` is undefined — runtime error | Critical | page.tsx:2673 |
| 1.2 | NC/RC revenue uses subtotal_price, not gross | Medium | route.ts:321-332 |
| 1.3 | COGS is flat % — no fulfillment/processing costs | Medium | page.tsx:96 |
| 1.4 | Off-Shopify revenue gets same COGS % applied | Medium | page.tsx:87,96 |
| 5.1 | Refunds attributed to refund date, not order date | Medium | route.ts:314,341 |
| 5.2 | 30-day sync window may miss month boundaries | Medium | route.ts:461-462 |
| 5.3 | No timezone conversion for date attribution | Medium | route.ts:314 |
| 5.6 | No data freshness indicator | Medium | page.tsx UI |
| 6.4 | CSV exports only visible rows | Medium | page.tsx:1927 |
| 7.2 | ~950 lines of dead placeholder data | Medium | page.tsx:132-1079 |
| 7.3 | Supabase client created on every render | Medium | page.tsx:1477 |
| 7.5 | No error state for failed data fetch | Medium | page.tsx:1650 |
| 8.2 | No TikTok/Pinterest spend integration | Medium | route.ts |
| 8.5 | Ad spend sync coupled to order sync | Medium | route.ts:569 |
| 1.5 | Contribution excludes variable costs | Low | page.tsx:97 |
| 2.3 | No daily averages or month-end projections | Low | page.tsx |
| 3.2 | Missing discount rate and refund rate columns | Low | page.tsx |
| 3.3 | Missing NC % column in table | Low | page.tsx |
| 4.2 | 62% margin hardcoded in 3 places | Low | multiple |
| 4.3 | Other spend saved as string not number | Low | page.tsx:1674 |
| 4.4 | No settings audit trail | Low | pnl-settings |
| 5.7 | No automatic/scheduled sync | Low | route.ts |
| 6.5 | No UTF-8 BOM for Excel | Low | page.tsx:1929 |
| 7.4 | No mobile-optimized view | Low | page.tsx:2553 |
| 7.6 | Dropdown doesn't close on outside click | Low | page.tsx:2085 |
| 7.8 | Stale data visible during brand switch | Low | page.tsx |
| 8.4 | Windsor date format not validated | Low | route.ts:591 |

---

## Prioritized Action Plan

### Phase 1 — Critical Fixes (Do Immediately)

1. **Fix Net Revenue Formula (1.1)** — Remove `- row.taxes` from the net revenue calculation in `calcFields()` at `page.tsx:87`. Taxes are not included in `grossSales` (which is `subtotal_price + total_discounts` from the sync), so subtracting them double-counts. This is the single highest-impact bug — it understates all revenue, contribution, MER, and AMER metrics.

2. **Fix `toggleMonth` undefined (7.1)** — Either add the function definition or remove the dead code branch at `page.tsx:2672-2674`. Currently this would throw a ReferenceError if reached.

3. **Fix NC Classification Fallback (5.4)** — When `lifetimeOrdersCount` is 0/undefined (enrichment failed), fall back to `customer.orders_count` from the embedded object, or default to treating unknown customers' first window order as NC. Add monitoring to alert when enrichment failure rate exceeds a threshold.

### Phase 2 — Medium Priority (This Sprint)

4. **Remove dead placeholder data (7.2)** — Delete `DATA_2025` and `DATA_2026` (lines 132-1079) to reduce bundle size.

5. **Add data freshness indicator (5.6)** — Show last sync timestamp from `synced_at` column.

6. **Add error state for data fetch failures (7.5)** — Show error banner with retry button.

7. **Fix CSV to export all days (6.4)** — Always export full daily data regardless of view.

8. **Fix Supabase client instantiation (7.3)** — Memoize the client.

### Phase 3 — Enhancements (Next Sprint)

9. **Increase default sync window (5.2)** — Change to 60 days or start-of-month.

10. **Add discount rate / refund rate columns (3.2)** — Quick calculated fields.

11. **Add month-end projection (2.3)** — `(MTD / days elapsed) * days in month`.

12. **Decouple ad spend sync from order sync (8.5)** — Separate endpoint.

13. **Add TikTok Ads integration (8.2)** — Automate spend pull.

14. **Clarify off-Shopify COGS treatment (1.4)** — Either exclude from COGS or add separate margin %.

### Phase 4 — Polish (Backlog)

15. Settings audit trail, UTF-8 BOM, mobile view, brand dropdown outside-click, loading skeleton during brand switch.
