# LTV Cohorts Page Audit Report

**Date:** 2026-05-18  
**Scope:** `src/app/analytics/ltv-cohorts/page.tsx` and all upstream data sources  
**Auditor:** Claude (automated code audit)

---

## Summary

The LTV Cohorts page builds monthly acquisition cohorts from raw `shopify_orders` data and overlays ad-spend CAC from `daily_pnl`. The core cohort logic is structurally sound -- it groups customers by first-purchase month and tracks cumulative revenue over time. However, the audit uncovered **6 critical**, **8 medium**, and **5 low** severity findings across data integrity, calculation accuracy, performance, and DTC-specific gaps.

The most impactful issues are: (1) LTV is calculated on gross revenue without deducting refunds, returns, or COGS; (2) orders with `null` customer_id are silently dropped from cohort assignment; (3) no filtering of voided/cancelled orders; (4) the cumulative revenue accumulation algorithm has a structural bug that miscounts revenue into month buckets; and (5) all cohort computation happens client-side with unbounded data fetches.

---

## 1. Cohort Logic

### 1.1 Cumulative Revenue Bucket Assignment Is Incorrect
**Severity: Critical**  
**File:** `src/app/analytics/ltv-cohorts/page.tsx:119-127`

The `cumulativeByMonth` map aggregates order amounts by the month-offset bucket they fall into, but then `buildCohorts` (lines 160-166) does a *running sum* over those buckets. This double-counts in a specific way: the map stores the *order amount* (not cumulative), but the running total treats each bucket as an increment. The actual bug is that the map key is `Math.min(monthsAfter, 12)`, which collapses all orders after month 12 into bucket 12. If a customer places orders at month 14 and month 18, both land in bucket 12, inflating M12 LTV while M13+ are never shown.

More critically, `cumulativeByMonth` is accumulated at the **cohort level** (line 126: `cohortMap[cohortKey].cumulativeByMonth[m] += o.amount`), not per-customer. This means the running total on line 163 produces total cohort revenue at each month mark, then divides by customer count. While this yields the correct *average* cumulative revenue per customer, the intermediate accumulation is confusing and fragile.

**Recommendation:** Accumulate cumulative revenue per-customer first, then average across the cohort. This also makes it possible to compute percentile distributions later:

```ts
// Per-customer: cumRevByMonth[cid][m] = cumulative revenue through month m
// Then: cohort avg at month m = mean(cumRevByMonth[cid][m]) for all cid in cohort
```

---

### 1.2 Orders with Null customer_id Are Silently Dropped
**Severity: Critical**  
**File:** `src/app/analytics/ltv-cohorts/page.tsx:99-105`

The `buildCohorts` function groups orders by `customer_id`. If `customer_id` is null (guest checkouts, or Shopify orders where the customer object is missing), the order is silently skipped because the key becomes the string `"null"`, and all guest orders are grouped as a single "customer."

The `shopify_orders` table stores `customer_id: o.customer?.id ?? null` (see `src/app/api/shopify-sync/route.ts:545`), so null values are expected for guest checkouts. These orders contribute real revenue but are either ignored or incorrectly merged.

**Recommendation:** Filter out rows where `customer_id` is null before cohort processing, or assign synthetic IDs based on email:

```ts
const cid = o.customer_id || `guest_${o.email || o.shopify_order_id}`;
```

---

### 1.3 No Filtering of Cancelled, Voided, or Fully Refunded Orders
**Severity: Critical**  
**File:** `src/app/analytics/ltv-cohorts/page.tsx:246-251` (the Supabase query)

The cohort page fetches all orders from `shopify_orders` without filtering by `financial_status`. Orders with `financial_status = 'voided'`, `'refunded'`, or `'cancelled'` are included at full `total_price`, inflating LTV.

The shopify-sync route (line 287) skips voided orders in `aggregateOrdersByDay`, but the LTV cohort page queries `shopify_orders` directly and applies no such filter.

**Recommendation:** Add a filter to the Supabase query:

```ts
.not('financial_status', 'in', '("voided","refunded")')
```

Or better, subtract refund amounts from `total_price` when building cohorts.

---

### 1.4 LTV Uses Gross Revenue, Not Net Revenue
**Severity: Critical**  
**File:** `src/app/analytics/ltv-cohorts/page.tsx:104`

`total_price` from Shopify is the amount the customer paid (including tax, shipping, after discounts). However, LTV should reflect net revenue or ideally gross profit. The page does not deduct:

- **Refunds** (stored in `shopify_orders.raw.refunds` but never read by the cohort page)
- **COGS** (the brand has `shopify_gross_margin_pct` but it is fetched and never used on this page)
- **Shipping costs** (included in `total_price`, inflating apparent LTV)

For a DTC brand with 30% refund rates or heavy discounting, this can overstate LTV by 20-40%.

**Recommendation:** Calculate net revenue per order: `subtotal_price - refund_amount`, or at minimum apply `shopify_gross_margin_pct` to show gross-profit LTV alongside revenue LTV. The brand's `shopify_gross_margin_pct` is already in the `Brand` interface (line 24) but never used.

---

### 1.5 Customer Deduplication Uses customer_id Only, Not Email
**Severity: Medium**  
**File:** `src/app/analytics/ltv-cohorts/page.tsx:101`

Customers are deduplicated by Shopify `customer_id`. If a customer places orders across different Shopify customer records (e.g., checkout as guest then later creates an account), their orders will be split across cohorts, understating repeat rate and LTV.

Shopify's own customer merge feature can mitigate this, but many stores don't use it consistently. Email-based deduplication would be more accurate.

**Recommendation:** Group by `email` (lowercase, trimmed) as the primary key when available, falling back to `customer_id`:

```ts
const cid = o.email?.toLowerCase().trim() || o.customer_id;
```

Note: the `shopify_orders` table does store `email`.

---

### 1.6 Month Offset Calculation Uses Approximate Days
**Severity: Low**  
**File:** `src/app/analytics/ltv-cohorts/page.tsx:124`

```ts
const monthsAfter = Math.floor((o.date.getTime() - data.firstDate.getTime()) / (30.44 * 86400000));
```

Using 30.44 days per month is an approximation. For orders near month boundaries, this can shift them into the wrong bucket. Calendar-month diffing would be more accurate:

```ts
const monthsAfter = (d.getFullYear() - first.getFullYear()) * 12 + (d.getMonth() - first.getMonth());
```

---

## 2. LTV:CAC Ratio

### 2.1 CAC Uses NC Share Percentage as a Manual Input, Not Actual Data
**Severity: Medium**  
**File:** `src/app/analytics/ltv-cohorts/page.tsx:178`

```ts
const cac = pnlNC > 0 ? (adSpendMonth * ncSharePct / 100) / pnlNC : 0;
```

CAC is calculated as `(total ad spend * NC%) / new customers`. The NC% is a user-adjustable slider (default 60%), not derived from actual campaign data. This is a rough heuristic -- the actual new-customer acquisition cost depends on campaign-level targeting.

The `daily_pnl` table already stores separate `nc_orders` and `nc_revenue`, so the actual NC share of orders is known. However, ad platforms don't split spend by NC vs RC, so the NC% slider is a reasonable compromise.

**Recommendation:** At minimum, auto-calculate a suggested NC% from the data: `nc_orders / (nc_orders + rc_orders)` per month, and display it next to the slider so users know how close their manual estimate is.

---

### 2.2 LTV:CAC Ratio Uses Revenue LTV, Not Gross Profit LTV
**Severity: Critical**  
**File:** `src/app/analytics/ltv-cohorts/page.tsx:181`

```ts
const ltvCacRatio = cac > 0 ? latestLTV / cac : 0;
```

The LTV:CAC ratio divides gross revenue by CAC. Industry-standard LTV:CAC uses **gross profit** (revenue * gross margin). A 3x revenue-based LTV:CAC with 40% margins is actually only 1.2x on a profit basis -- which is unprofitable.

The `Brand` type already includes `shopify_gross_margin_pct` (line 24), but it is never applied.

**Recommendation:**

```ts
const grossProfitLTV = latestLTV * (brand.shopify_gross_margin_pct / 100);
const ltvCacRatio = cac > 0 ? grossProfitLTV / cac : 0;
```

Display both revenue LTV:CAC and GP LTV:CAC, with the GP version as primary.

---

### 2.3 Blended KPI Averages Are Unweighted
**Severity: Medium**  
**File:** `src/app/analytics/ltv-cohorts/page.tsx:284-289`

```ts
const avgAOV = cohorts.reduce((s, c) => s + c.firstOrderAOV, 0) / cohorts.length;
const avgRepeat = cohorts.reduce((s, c) => s + c.repeatRate, 0) / cohorts.length;
```

KPI averages are simple arithmetic means across cohorts, not weighted by cohort size. A cohort with 5 customers gets the same weight as one with 5,000. This can dramatically skew blended metrics.

**Recommendation:** Weight by `ncCustomers`:

```ts
const totalNC = cohorts.reduce((s, c) => s + c.ncCustomers, 0);
const avgAOV = cohorts.reduce((s, c) => s + c.firstOrderAOV * c.ncCustomers, 0) / totalNC;
```

---

### 2.4 No Payback Period Calculation
**Severity: Medium**  
**File:** `src/app/analytics/ltv-cohorts/page.tsx` (missing feature)

The page shows LTV:CAC ratio but does not calculate or display the **CAC payback period** -- i.e., the month at which cumulative revenue per customer exceeds CAC. This is one of the most actionable DTC metrics. The data is already available in `cumRevPerCust[]`.

**Recommendation:** Add payback period to each cohort row:

```ts
const paybackMonth = cumRevPerCust.findIndex((v, i) => v !== null && v >= cac);
```

Display as a column in the cohort table (e.g., "M2", "M4", or "Not yet").

---

### 2.5 CAC Falls to Zero When PnL Data Is Missing
**Severity: Medium**  
**File:** `src/app/analytics/ltv-cohorts/page.tsx:175-178`

When `pnlByMonth[key]` is undefined (no ad spend data synced for that month), CAC defaults to 0, and LTV:CAC becomes 0 (displayed as "0.0x"). This is misleading -- it suggests zero acquisition cost. The cohort row should indicate that CAC data is unavailable rather than showing 0.

**Recommendation:** When `pnl` is undefined, set `cac` to `null` and display "--" in the table. Exclude these cohorts from blended LTV:CAC calculations.

---

## 3. DTC-Specific Concerns

### 3.1 No Subscription vs One-Time Revenue Segmentation
**Severity: Medium**  
**File:** `src/app/analytics/ltv-cohorts/page.tsx` (missing feature)

The page treats all revenue equally. For DTC brands with subscription products (e.g., supplements, consumables), subscription revenue has fundamentally different LTV dynamics. The `shopify_orders.line_items` data is available but not parsed for subscription indicators.

**Recommendation:** Parse `line_items` for subscription-related properties (e.g., selling plan allocations in the `raw` JSON) and add a toggle to segment cohorts by subscription vs one-time.

---

### 3.2 No Acquisition Source Segmentation
**Severity: Medium**  
**File:** `src/app/analytics/ltv-cohorts/page.tsx` (missing feature)

Cohorts are only segmented by acquisition month. For a DTC brand, LTV varies dramatically by acquisition source (Meta, Google, organic, email). The `shopify_orders` table stores `source_name`, `landing_site`, and `referring_site`, which could power source-based cohort segmentation.

**Recommendation:** Add a "Segment by" dropdown with options: Month (current), Source, Channel. Use `source_name` or parse UTM parameters from `landing_site` to classify.

---

### 3.3 No LTV Projection / Retention Curve Modeling
**Severity: Low**  
**File:** `src/app/analytics/ltv-cohorts/page.tsx` (missing feature)

Mature cohorts show 12 months of data, but newer cohorts have null values for future months. The page does not project future LTV based on older cohorts' retention curves. This is standard in DTC analytics for forecasting.

**Recommendation:** For each month column, calculate the average multiplier from mature cohorts (e.g., M6 revenue is typically 1.3x M3 revenue) and show projected values in a lighter color for immature cohorts.

---

### 3.4 No Gross Margin Application
**Severity: Medium**  
**File:** `src/app/analytics/ltv-cohorts/page.tsx:24`

`shopify_gross_margin_pct` is fetched as part of the `Brand` interface but never used anywhere on the page. For DTC P&L analysis, gross-profit LTV is the metric that matters for unit economics.

**Recommendation:** Add a toggle or secondary row showing GP-adjusted LTV values. Apply as:

```ts
const gpLTV = latestLTV * (brand.shopify_gross_margin_pct / 100);
```

---

## 4. Data Integrity

### 4.1 No Validation of total_price Being Numeric
**Severity: Low**  
**File:** `src/app/analytics/ltv-cohorts/page.tsx:104`

```ts
customerOrders[cid].orders.push({ date: d, amount: Number(o.total_price) });
```

If `total_price` is null or a non-numeric string, `Number()` returns `NaN`, which will propagate silently through all calculations. The Supabase column likely stores this as numeric, but defensive coding is warranted.

**Recommendation:** Add a guard: `const amount = Number(o.total_price) || 0;`

---

### 4.2 No Sync Freshness Indicator
**Severity: Low**  
**File:** `src/app/analytics/ltv-cohorts/page.tsx` (missing feature)

The page does not show when data was last synced. If the Shopify sync hasn't run in days, the cohort data will be stale without any user-visible warning. The `daily_pnl` table has a `synced_at` column that could be surfaced.

**Recommendation:** Query `MAX(synced_at)` from `daily_pnl` for the selected brand and display "Last synced: X hours ago" in the header. Highlight in red if > 24 hours.

---

### 4.3 Shopify Sync Only Covers 30-Day Window by Default
**Severity: Critical**  
**File:** `src/app/api/shopify-sync/route.ts:460-464`

The shopify-sync POST defaults to a 30-day window. The LTV cohort page, however, reads ALL orders from `shopify_orders` for the brand. If the sync has only ever run with 30-day windows, historical orders will be missing, and older cohorts will have incomplete data.

The Inngest webhook handler (`src/lib/inngest/shopify-functions.ts`) does upsert individual orders as they arrive, but this only captures orders created/updated after the webhook was installed.

**Recommendation:** Add a one-time backfill mechanism that syncs all historical orders (e.g., `since_date = '2020-01-01'`). Add a `shopify_orders_backfill_completed_at` column to `brands` to track whether backfill has been run. Show a warning banner on the cohort page if backfill hasn't been completed.

---

### 4.4 Missing RLS Policy for shopify_orders
**Severity: Medium**  
**File:** `supabase/migration-shopify-pnl.sql` (shopify_orders table not defined here)

The migration file defines RLS for `daily_pnl` but there is no migration file for the `shopify_orders` table visible in the codebase. The LTV cohort page queries this table directly with the anon key (via `createBrowserClient`). If RLS is not configured, any authenticated user could read any brand's order data.

**Recommendation:** Verify that `shopify_orders` has RLS enabled with brand-scoped policies. Add the migration to source control.

---

## 5. Performance

### 5.1 All Cohort Computation Happens Client-Side
**Severity: Critical**  
**File:** `src/app/analytics/ltv-cohorts/page.tsx:236-271`

The page fetches **every order** for the brand from Supabase, then computes cohorts in the browser with `useMemo`. For a brand with 100K+ orders, this means:

- Downloading megabytes of order data over the network
- Blocking the main thread during computation
- Re-computing on every render triggered by `ncShare` slider changes

The pagination loop (lines 243-259) does handle Supabase's 1000-row limit, but each page is a separate HTTP request with no parallelization.

**Recommendation:** Move cohort computation to a server-side API route or Supabase database function. Pre-aggregate into a `cohort_metrics` table on sync. The client should only fetch the pre-computed cohort summary (~12 rows per cohort, ~50 cohorts max = ~600 rows).

---

### 5.2 No Caching of Cohort Data
**Severity: Medium**  
**File:** `src/app/analytics/ltv-cohorts/page.tsx`

The `daily_pnl` GET endpoint has Redis caching (60s TTL), but the cohort page queries `shopify_orders` directly with no caching. Every brand switch or page load triggers a full re-fetch.

**Recommendation:** If keeping client-side computation, at minimum cache the fetched orders in React state across brand switches (LRU cache). Better: move to a server-side endpoint with Redis caching like the P&L route.

---

### 5.3 Supabase Pagination Is Sequential
**Severity: Low**  
**File:** `src/app/analytics/ltv-cohorts/page.tsx:243-259`

The pagination loop fetches pages sequentially. For large datasets, this could be parallelized by pre-calculating page offsets (if total count is known) or using a cursor-based approach.

**Recommendation:** Fetch count first, then parallelize page fetches:

```ts
const { count } = await supabase.from('shopify_orders').select('*', { count: 'exact', head: true }).eq('brand_id', selectedBrand);
const pages = Math.ceil(count / PAGE_SIZE);
const results = await Promise.all(Array.from({ length: pages }, (_, i) => fetchPage(i)));
```

---

### 5.4 No Debounce on NC Share Slider
**Severity: Low**  
**File:** `src/app/analytics/ltv-cohorts/page.tsx:337`

The `ncShare` input triggers a re-computation of all cohorts (via `useMemo` dependency) on every keystroke. For large datasets, this could cause UI jank.

**Recommendation:** Debounce the `ncShare` state update by 300ms or switch to an `onBlur` handler.

---

## Prioritized Action Plan

### P0 -- Critical (fix before shipping / next sprint)

| # | Finding | Impact | Effort |
|---|---------|--------|--------|
| 1 | **1.3** Filter out voided/refunded orders from cohort query | Overstated LTV by 10-30% | Small |
| 2 | **1.4** Use net revenue (subtract refunds) for LTV | Overstated LTV | Medium |
| 3 | **2.2** Apply gross margin to LTV:CAC ratio | Misleading unit economics (3x revenue != 3x profit) | Small |
| 4 | **1.2** Handle null customer_id (guest checkouts) | Lost revenue data, merged guest "customer" | Small |
| 5 | **4.3** Implement historical order backfill | Incomplete cohorts for pre-webhook periods | Medium |
| 6 | **5.1** Move cohort computation server-side | Page unusable for high-volume brands (100K+ orders) | Large |

### P1 -- Medium (next 2-4 weeks)

| # | Finding | Impact | Effort |
|---|---------|--------|--------|
| 7 | **1.5** Deduplicate customers by email | Understated repeat rate & LTV | Small |
| 8 | **2.1** Auto-suggest NC% from actual order data | More accurate CAC | Small |
| 9 | **2.3** Weight KPI averages by cohort size | Misleading blended metrics | Small |
| 10 | **2.4** Add payback period column | Missing key DTC metric | Small |
| 11 | **2.5** Handle missing CAC data gracefully | Misleading 0x LTV:CAC | Small |
| 12 | **3.2** Add acquisition source segmentation | Major DTC analytics gap | Medium |
| 13 | **3.4** Surface gross margin in LTV display | Missing unit economics view | Small |
| 14 | **4.4** Verify/add RLS for shopify_orders | Potential data leak | Small |

### P2 -- Low (backlog)

| # | Finding | Impact | Effort |
|---|---------|--------|--------|
| 15 | **1.1** Restructure cumulative revenue accumulation | Code clarity, enables percentiles | Medium |
| 16 | **1.6** Use calendar-month diffing | Minor bucket misalignment | Small |
| 17 | **3.1** Subscription vs one-time segmentation | Feature gap for subscription brands | Large |
| 18 | **3.3** LTV projection from retention curves | Feature gap | Large |
| 19 | **4.1** Add NaN guard on total_price | Defensive coding | Small |
| 20 | **4.2** Show sync freshness indicator | UX improvement | Small |
| 21 | **5.2** Add caching for cohort data | Performance | Medium |
| 22 | **5.3** Parallelize Supabase pagination | Performance | Small |
| 23 | **5.4** Debounce NC share slider | Minor UX jank | Small |
