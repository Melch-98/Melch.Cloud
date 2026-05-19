# Marginal Efficiency Curve -- Audit Report

**Date:** 2026-05-18
**Scope:** `src/app/analytics/efficiency/page.tsx` and all supporting data paths
**Auditor:** Claude Opus 4.6

---

## Summary

The Efficiency Curve page implements a Hill saturation model to recommend optimal daily Meta ad spend. The core Hill function and its derivative are mathematically correct. The curve-fitting approach (two-pass grid search with weighted least squares) is functional but has several material issues: it only models Meta spend, it ignores Google spend entirely despite having the data, the adstock transform is wrong, the `maxRev` and `maxNCRev` optimization goals are degenerate, and the page has no chart visualization despite computing curve data. The RLS policy also silently blocks founder users from seeing any data. For a DTC brand spending $300-$1,500/day on Meta, the model range and defaults are appropriate, but the lack of per-channel modeling and the blending of organic + paid revenue into a single response curve materially weakens the output.

---

## 1. MATH MODEL

### 1.1 Hill Function -- Correct
**Severity:** N/A (pass)
**File:** `page.tsx:49-51`

The Hill function `y = V * s^h / (K^h + s^h)` is correctly implemented. When `s = K`, the function returns `V/2` (half-saturation), which is the expected behavior.

### 1.2 Marginal ROAS (Derivative) -- Correct
**Severity:** N/A (pass)
**File:** `page.tsx:54-58`

The derivative `dR/ds = V * h * K^h * s^(h-1) / (K^h + s^h)^2` is the correct analytical derivative of the Hill function. This properly models the marginal return on the next dollar of spend.

### 1.3 Adstock Transform Is Mathematically Wrong
**Severity:** Critical
**File:** `page.tsx:289-290`

```js
const adjustedPoints = params.lam > 0
  ? dailyPoints.map(p => ({ ...p, spend: p.spend / (1 - params.lam) }))
  : dailyPoints;
```

This divides each day's spend by `(1 - lambda)` -- a scalar inflation. A proper adstock transform is a recursive carry-over: `adstock_t = spend_t + lambda * adstock_{t-1}`. The current implementation just uniformly scales all spend values up by a constant factor, which is equivalent to relabeling the x-axis and has no meaningful effect on the shape or insights of the fitted curve. It will produce identical ROAS and marginal ROAS values as lambda=0, just at different apparent spend levels.

**Recommendation:** Implement proper geometric adstock:
```js
const adjustedPoints = [...dailyPoints];
if (params.lam > 0) {
  for (let i = 1; i < adjustedPoints.length; i++) {
    adjustedPoints[i] = {
      ...adjustedPoints[i],
      spend: adjustedPoints[i].spend + params.lam * adjustedPoints[i - 1].spend,
    };
  }
}
```
Or remove the feature until it can be done correctly, since a wrong adstock is worse than no adstock.

### 1.4 `maxRev` and `maxNCRev` Goals Are Degenerate
**Severity:** Medium
**File:** `page.tsx:171-172`

```js
case 'maxRev': return bruteMax(s => hillRev(s, V, K, h));
case 'maxNCRev': return bruteMax(s => hillRev(s, V, K, h) * ncPct);
```

The Hill function is monotonically increasing -- it never decreases. Therefore `bruteMax` will always return `maxSearch` (= `V * 2`) for both goals, because revenue is always higher at higher spend. These goals need to be either: (a) removed, (b) capped at some budget constraint, or (c) reformulated (e.g., maximize revenue per dollar, or maximize revenue subject to a budget ceiling).

The `maxNCRev` case is even more meaningless because multiplying by a constant `ncPct` does not change the argmax.

**Recommendation:** Either add a budget constraint parameter, or reformulate these as "max revenue subject to CM >= 0" or "max revenue subject to ROAS >= 1.0". Alternatively, remove these goals.

### 1.5 Grid Search Resolution May Miss True Optimum
**Severity:** Low
**File:** `page.tsx:83-110`

The coarse grid searches V in 16 steps from `0.5 * maxR` to `8 * maxR`, K in 16 steps from `0.1 * maxS` to `1.6 * maxS`, and h from 0.6 to 2.7 in 8 steps. The fine grid refines around the best, but only tests ~1,331 points per pass. For data with an unusual shape, the true minimum could lie between grid points.

**Recommendation:** This is acceptable for a UI tool but consider adding a gradient descent refinement step after the grid search, or use Nelder-Mead. At minimum, add a third refinement pass.

### 1.6 R-squared Not Displayed With Warning for Poor Fits
**Severity:** Medium
**File:** `page.tsx:461`

The R-squared is displayed but no warning is shown when it is low (e.g., < 0.5). A poor fit means the Hill model is inappropriate for this data, and the optimal spend recommendation could be wildly wrong.

**Recommendation:** Add a visual warning (red text, alert banner) when `r2 < 0.5`, and a caution indicator when `r2 < 0.7`. Consider disabling the "Optimal Spend" recommendation when the fit is poor.

### 1.7 Brute-Force Optimization Uses Only 500 Steps
**Severity:** Low
**File:** `page.tsx:151, 158-163`

The `findOptimalSpend` function searches `maxSearch = V * 2` in 500 steps. For a brand with V = $50,000 (plausible for a brand doing $500K/mo), this means steps of $200. The optimal spend could be off by up to $200. This is generally acceptable for DTC budget planning but could be improved.

**Recommendation:** Consider binary search or golden section search for the unimodal CM function instead of brute force.

---

## 2. DTC RELEVANCE

### 2.1 Meta-Only Model Ignores Google Spend
**Severity:** Critical
**File:** `page.tsx:258`

```js
const spend = Number(row.meta_spend || 0);
```

The query fetches `meta_spend` from `daily_pnl`, but the table also has `google_spend` and `other_spend` columns with real data (confirmed from `update-ad-spend.sql`). Google spend ranges from $130-$380/day for the sample brand. By fitting the curve on Meta spend alone but using `gross_sales` (total revenue from all channels including organic), the model conflates Meta's contribution with Google's and organic revenue.

This means: (a) the model overestimates Meta's efficiency (attributing Google-driven revenue to Meta), (b) the optimal Meta spend recommendation is too high, and (c) brands with heavy Google spend will get especially misleading results.

**Recommendation:** Either:
- Model total ad spend (`meta_spend + google_spend + other_spend`) against total revenue, or
- Model each channel separately (requires channel-attributed revenue, which isn't in the current schema), or
- At minimum, make the X-axis selectable: Meta only / Google only / Total spend
- Add a prominent disclaimer: "This model attributes all revenue to Meta spend and does not account for other channels."

### 2.2 Revenue Includes Organic -- No Attribution
**Severity:** Critical
**File:** `page.tsx:259`

```js
const rev = Number(row.gross_sales || 0);
```

`gross_sales` is total Shopify revenue including organic, email, referral, and all paid channels. Fitting a curve of Meta spend vs. total revenue creates a floor effect: even at $0 Meta spend, organic revenue would be non-zero. The Hill function passes through the origin (`hillRev(0) = 0`), which means the model is forced to attribute all revenue to Meta. This systematically overfits the intercept region and distorts the curve shape.

**Recommendation:** Use `nc_revenue` as the response variable (more likely to be ad-driven), or better yet, add a `meta_attributed_revenue` column using platform-reported conversions. At minimum, document this limitation prominently.

### 2.3 No Accounting for Meta's Internal Optimization
**Severity:** Medium
**File:** N/A (architectural)

Meta's algorithm already optimizes within its own budget (CBO, Advantage+ campaigns). The Hill curve fits daily spend-to-revenue, but Meta redistributes budget across ad sets and audiences within a day. This means the "diminishing returns" the model captures are a blend of true market saturation and Meta's own optimization efficiency. The model cannot distinguish between "we've saturated our audience" and "Meta's algorithm already found the best pockets."

**Recommendation:** Add a note in the UI explaining this limitation. Consider using weekly aggregations instead of daily to smooth out Meta's intra-day optimization noise.

### 2.4 Spend Slider Range Is Appropriate
**Severity:** N/A (pass)
**File:** `page.tsx:204`

The default current daily spend of $1,200 and the ability to adjust freely is appropriate for DTC brands. The sample data shows Meta spend ranging from $350-$2,000/day, which is a realistic range.

### 2.5 KPI Cards Are Mostly Actionable
**Severity:** Low
**File:** `page.tsx:422-451`

The five KPI cards (Optimal Daily Spend, Expected Revenue, Contribution Margin, Current Marginal ROAS, Spend Change %) are well-chosen for a DTC operator. However, "Current Marginal ROAS" returns `Infinity` when current spend is 0, which would display as "Infinity x" in the UI.

**Recommendation:** Add a guard: `const curMROAS = params.curSpend > 0 ? hillMargRoas(...) : 0;` -- but actually `hillMargRoas` already returns `Infinity` for `s <= 0` (line 55), so this is guarded. The issue is that `fmt(Infinity, 2)` will produce "Infinity" as a string. Add: `if (!isFinite(analysis.curMROAS)) display "N/A"`.

### 2.6 LTV Multipliers Are Hardcoded Defaults
**Severity:** Medium
**File:** `page.tsx:204-206`

```js
l3: 1.4, l6: 1.8, l12: 2.5,
```

These LTV multipliers (1.4x at 3 months, 2.5x at 12 months) are presented as tunable parameters, which is good. However, they are hardcoded defaults with no connection to actual cohort data. The LTV Cohorts page exists in the nav -- these defaults should ideally be populated from that analysis.

**Recommendation:** Fetch actual LTV multipliers from the LTV cohorts analysis for the selected brand, and use them as defaults. Fall back to these hardcoded values only when cohort data is unavailable.

---

## 3. DATA SOURCE

### 3.1 Data Is Real -- Synced From Shopify + Meta API
**Severity:** N/A (pass)
**File:** `src/app/api/shopify-sync/route.ts:497-516, 601-651`

The data is not synthetic. It comes from real Shopify order data (aggregated by day) and real Meta Marketing API spend data, upserted into the `daily_pnl` table. This is confirmed by the sync route and the manual SQL updates for the Tallow Twins brand.

### 3.2 No Date Range Filter -- Queries All Historical Data
**Severity:** Medium
**File:** `page.tsx:254-257`

```js
const { data } = await supabase
  .from('daily_pnl')
  .select('date, nc_revenue, rc_revenue, gross_sales, meta_spend')
  .eq('brand_id', selectedBrand)
  .order('date', { ascending: true });
```

There is no date range filter. For a brand with years of data, this will: (a) pull thousands of rows to the client, (b) include spend data from periods with radically different strategies/products/seasonality, and (c) the recency weighting (half-life) partially addresses staleness but does not eliminate it.

**Recommendation:** Add a date range selector (last 30d, 90d, 180d, 365d, all) and default to 90 days. This both improves query performance and model relevance.

### 3.3 Founder Role Has No RLS Access to daily_pnl
**Severity:** Critical
**File:** `supabase/migration-shopify-pnl.sql:56-84`

The RLS policies only grant access to `admin` (full CRUD) and `strategist` (read own brand). The `founder` role is not included in any policy. However, the Navbar shows the Efficiency Curve page to founders (`roles: ['admin', 'founder']`). This means founders will see the page but get zero data back -- a silent failure with no error message. The page will show the empty state "No spend data available."

**Recommendation:** Add a founder RLS policy:
```sql
CREATE POLICY "Founders can read own brand daily_pnl"
ON daily_pnl FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM users_profile
    WHERE id = auth.uid()
      AND role = 'founder'
      AND brand_id = daily_pnl.brand_id
  )
);
```

---

## 4. EDGE CASES

### 4.1 Single Data Point Produces Meaningless Fit
**Severity:** Medium
**File:** `page.tsx:62-124`

With a single data point, `fitHillCurve` will run the full grid search and find parameters that exactly pass through that point (SSE = 0, R-squared = undefined since ssTot = 0). The model will output an "optimal spend" based on a single observation.

**Recommendation:** Require a minimum of 14 data points (2 weeks) before showing results. Display a message like "Need at least 14 days of data to fit a reliable curve."

### 4.2 Division by Zero in Ladder `cmPct` Calculation
**Severity:** Low
**File:** `page.tsx:326`

```js
const cmPct = rev > 0 ? cm / rev * 100 : 0;
```

This is properly guarded. No issue.

### 4.3 Brand Switching Does Not Reset Parameters
**Severity:** Medium
**File:** `page.tsx:246-282`

When switching brands, only `vc` (from `shopify_gross_margin_pct`) and `curSpend` (from recent average) are updated. The LTV multipliers, NC share %, target ROAS, half-life, and adstock remain from the previous brand's settings. This could lead to incorrect recommendations if a user views Brand A (high LTV), adjusts LTV to 3.5x, then switches to Brand B (low LTV) -- the 3.5x carries over silently.

**Recommendation:** Reset all params to defaults when brand changes, then apply brand-specific overrides.

### 4.4 `shopify_gross_margin_pct` Could Be Null or Zero
**Severity:** Low
**File:** `page.tsx:236, 252`

```js
if (brand) updateParam('vc', 100 - brand.shopify_gross_margin_pct);
```

If `shopify_gross_margin_pct` is `null` (which the DB allows, though it defaults to 62), this becomes `100 - null = NaN`, and all CM calculations break silently.

**Recommendation:** Guard: `updateParam('vc', 100 - (brand.shopify_gross_margin_pct ?? 62))`.

### 4.5 Infinity Display in Marginal ROAS
**Severity:** Low
**File:** `page.tsx:54-55`

`hillMargRoas` returns `Infinity` when `s <= 0`. If a user sets current spend to 0, the KPI card will show "Infinity x". The `fmt()` function will produce the string "Infinity".

**Recommendation:** In the KPI display, check `isFinite(analysis.curMROAS)` and show "N/A" or a capped value instead.

---

## 5. UX

### 5.1 No Chart Visualization Despite Computing Curve Data
**Severity:** Critical
**File:** `page.tsx:309-311`

The code computes `curveData` (200-point array of spend/rev/mroas), but it is never rendered. There is no chart component on the page. The entire "Marginal Efficiency Curve" page has no curve visualization -- only a spend ladder table. This is the single most impactful UX gap: the curve is the core value proposition of this page.

**Recommendation:** Add a Recharts or similar chart showing:
- X-axis: Daily Spend
- Y-axis left: Revenue (Hill curve line + scatter of actual data points)
- Y-axis right: Marginal ROAS
- Vertical lines at current spend and optimal spend
- The scatter plot of actual daily data points overlaid on the fitted curve

### 5.2 Spend Ladder Table Is Dense But Useful
**Severity:** Low
**File:** `page.tsx:467-513`

The ladder table is well-structured with color coding for positive/negative CM and current/optimal markers. The 200-step increment is reasonable. However, for brands spending $300/day, the table could have 50+ rows, most of which are above the relevant range.

**Recommendation:** Limit the ladder to ~15-20 rows centered around current and optimal spend, with a "Show all" toggle.

### 5.3 No Explanation of What "Optimal" Means Per Goal
**Severity:** Medium
**File:** `page.tsx:128-136`

The goal descriptions are terse (e.g., "Maximize contribution margin today"). A non-technical founder won't understand the difference between "Max CM Today" and "Max 3m CM", or why the recommended spend changes between them.

**Recommendation:** Add a tooltip or expandable section explaining each goal in plain language, e.g.: "Max CM Today tells you the spend level where each additional dollar costs more than the gross profit it generates. Max 3m CM accounts for repeat purchases over the next 3 months, so it recommends spending more aggressively."

### 5.4 No Loading State for Brand Switch
**Severity:** Low
**File:** `page.tsx:248`

When switching brands, `setLoading(true)` is called, but the old analysis remains visible via `useMemo` until new data arrives. The loading spinner only shows when `loading && !analysis` (line 338). This means stale data from the previous brand is shown during the fetch.

**Recommendation:** Clear `dailyPoints` immediately on brand switch: add `setDailyPoints([])` before `setLoading(true)` in the fetch function.

### 5.5 Hill Curve Parameters Shown But Not Explained
**Severity:** Low
**File:** `page.tsx:454-464`

The display shows V, K, h, and R-squared but only the info block at the bottom (line 521) briefly explains what h means. V and K are not explained. A founder seeing "K (half-sat) = $1,247" will not understand what half-saturation means.

**Recommendation:** Add tooltips: "V = maximum possible daily revenue", "K = the spend level where you achieve half of maximum revenue", "h = curve steepness (higher = sharper inflection)".

---

## Prioritized Action Plan

### P0 -- Critical (fix before showing to clients)

| # | Finding | Impact | Effort |
|---|---------|--------|--------|
| 1 | **Founder RLS policy missing** (3.3) | Founders see empty page | 5 min SQL migration |
| 2 | **Revenue includes organic** (2.2) | Model overstates Meta's contribution | Medium -- requires schema discussion |
| 3 | **Google spend ignored** (2.1) | Model attributes Google revenue to Meta | Small -- add `google_spend` to X-axis or offer total spend toggle |
| 4 | **No chart visualization** (5.1) | Page's core feature is missing | Medium -- add Recharts component |

### P1 -- Medium (fix before scaling to more brands)

| # | Finding | Impact | Effort |
|---|---------|--------|--------|
| 5 | **Adstock transform is wrong** (1.3) | Feature is misleading | Small -- fix or remove |
| 6 | **maxRev / maxNCRev goals are degenerate** (1.4) | Always returns max spend | Small -- reformulate or remove |
| 7 | **No R-squared warning** (1.6) | Bad fits produce bad recs silently | Small -- conditional banner |
| 8 | **No date range filter** (3.2) | Performance + stale data | Medium -- add selector |
| 9 | **Brand switch doesn't reset params** (4.3) | Cross-brand parameter leakage | Small |
| 10 | **Single data point** (4.1) | Meaningless fit shown | Small -- minimum threshold |
| 11 | **Goal explanations** (5.3) | Founders confused | Small -- tooltips |
| 12 | **LTV from cohort data** (2.6) | Defaults may be wrong per brand | Medium -- integration work |

### P2 -- Low (polish)

| # | Finding | Impact | Effort |
|---|---------|--------|--------|
| 13 | Null margin guard (4.4) | NaN propagation | Trivial |
| 14 | Infinity display (4.5) | Ugly UI | Trivial |
| 15 | Stale data during brand switch (5.4) | Minor UX | Trivial |
| 16 | Ladder table length (5.2) | UX density | Small |
| 17 | Parameter tooltips (5.5) | Comprehension | Small |
| 18 | Grid search refinement (1.5) | Marginal accuracy | Medium |
| 19 | Brute-force steps (1.7) | $200 granularity | Small |
