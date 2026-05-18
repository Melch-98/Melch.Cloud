# Ad Perspective Page Audit Report

**Date:** 2026-05-18
**Scope:** `src/app/analytics/ad-perspective/page.tsx`, `src/app/api/meta-insights/route.ts`, `src/app/api/campaign-metrics/route.ts`, `src/lib/meta-api.ts`

---

## Summary

The Ad Perspective page is a Pareto/percentile analysis tool for ad creative performance. It fetches ad-level insights from Meta's Marketing API via `/api/meta-insights`, computes percentile distributions, winner/loser classification, and a "cost til next winner" estimator. Overall the data pipeline is solid -- ROAS is correctly calculated as `purchase_value / spend`, the `safeNum` helper guards against NaN from Meta's string-typed fields, and division-by-zero is guarded in most places. However, there are several logic bugs in the percentile computation, missing DTC-critical metrics, a hard 200-ad limit that silently truncates analysis, and UX gaps around error recovery and mobile usability.

**Critical findings:** 3 | **Medium findings:** 9 | **Low findings:** 6

---

## 1. Data Accuracy

### 1.1 ROAS Calculation is Correct
- **Assessment:** ROAS is calculated as `purchaseValue / spend` in both `meta-api.ts:706` and `campaign-metrics/route.ts:183`. This uses Meta's `action_values` for purchase (revenue) and `spend` for cost -- the standard DTC formula.
- **Severity:** N/A (no issue)

### 1.2 Thumbstop Rate Uses video_p25 as Proxy for 3-Second Views
- **Description:** Thumbstop rate is calculated as `(videoP25 / impressions) * 100` at `meta-api.ts:704`. Meta's `video_p25_watched_actions` counts views that reached 25% of the video, NOT 3-second views. The correct field for 3-second views is `video_3_sec_watched_actions` (or `video_play_actions` with `action_type=video_view`). For short videos (< 12 seconds), p25 approximates 3s, but for longer videos this significantly understates the thumbstop rate.
- **Severity:** Medium
- **File:** `src/lib/meta-api.ts:704`
- **Recommendation:** Request `video_3_sec_watched_actions` from Meta's API (add to `insightsFields` array at line 265) and use that for thumbstop. Keep p25 as a separate "25% retention" metric. Update the label in `page.tsx:165` from "Thumbstop / Hookrate" to be more precise.

### 1.3 Attribution Window Not Specified
- **Description:** The Meta API insights request at `meta-api.ts:297` does not specify `action_attribution_windows`. Meta defaults to 7-day click / 1-day view, but this is not documented anywhere in the UI and cannot be changed by the user.
- **Severity:** Medium
- **File:** `src/lib/meta-api.ts:297`
- **Recommendation:** Add `action_attribution_windows` parameter to the API request (e.g., `["7d_click","1d_view"]`) and display the active attribution window in the page header. Consider allowing the user to toggle between 1d click, 7d click, and 28d click.

### 1.4 Campaign Type Hardcoded to "SALES" in campaign-metrics
- **Description:** At `campaign-metrics/route.ts:173`, all Meta campaigns are hardcoded as `campaignType: 'SALES'` with a comment "Meta campaigns for this account are all OUTCOME_SALES." This is a brittle assumption -- prospecting, awareness, and traffic campaigns will be misclassified.
- **Severity:** Medium
- **File:** `src/app/api/campaign-metrics/route.ts:173`
- **Recommendation:** Request the `campaign.objective` field from Meta's insights API and map it to the campaign type. Add `objective` to the fields list in the API call at line 119.

### 1.5 Google Ads "last_14d" Falls Back to LAST_7_DAYS
- **Description:** In the Google date range mapping at `campaign-metrics/route.ts:91`, `'last_14d'` maps to `'LAST_7_DAYS'` with a comment "fallback." This silently returns only 7 days of data when the user selects 14 days.
- **Severity:** Critical
- **File:** `src/app/api/campaign-metrics/route.ts:91`
- **Recommendation:** Either implement a proper 14-day range for Windsor/Google Ads, or remove the 14-day option from the UI for Google campaigns, or use custom date range parameters (`since`/`until`) instead of presets.

---

## 2. Logic Bugs

### 2.1 Percentile Distribution Table Computes Cumulative, Not Per-Bucket
- **Description:** The percentile distribution at `page.tsx:668-704` computes cumulative slices (`sortedAds.slice(0, total - threshold)`) rather than per-bucket values. For example, the "95%" row includes ALL ads from the top 5% down, not just the ads in the 90-95% bucket. The column headers say "Count" but every row shows the cumulative count. This makes the SOS/SOR/SOP columns misleading -- they always increase monotonically to 100%, which provides no insight into where the Pareto inflection point is.
- **Severity:** Medium
- **File:** `src/app/analytics/ad-perspective/page.tsx:668-704`
- **Recommendation:** Either (a) relabel the table as "Cumulative Distribution" and add a note explaining cumulative semantics, or (b) compute per-bucket metrics by subtracting the previous bucket's values from the current one.

### 2.2 Median Row Calculation is Wrong
- **Description:** At `page.tsx:605-610`, the "Median" row takes the single middle element of the spend-sorted array. For an even number of ads, the median should be the average of the two middle elements. More importantly, the `count` field for Median is `total - Math.floor(total / 2)` which represents "ads from median position downward" -- an odd choice that doesn't correspond to any standard statistical concept.
- **Severity:** Low
- **File:** `src/app/analytics/ad-perspective/page.tsx:605-610`
- **Recommendation:** For proper median: use average of `sortedAds[mid-1]` and `sortedAds[mid]` when `total` is even. Clarify what the "count" column means for the Median row.

### 2.3 Average ROAS Uses Weighted Average (Correct) But CPA Uses Per-Ad Average (Incorrect Denominator)
- **Description:** At `page.tsx:600`, the average CPA is calculated as `aSpend / aPurchases` where `aSpend = totalSpend / total` and `aPurchases = totalPurchases / total`. This simplifies to `totalSpend / totalPurchases` which is actually the weighted average CPA (correct). However, this is NOT the "average CPA" -- it's the blended CPA. The label "Average" suggests a simple average of per-ad CPAs, which would give different results. The math is defensible but the labeling is ambiguous.
- **Severity:** Low
- **File:** `src/app/analytics/ad-perspective/page.tsx:596-601`
- **Recommendation:** Add a tooltip or info icon clarifying this is spend-weighted (blended) CPA, not a simple average of individual ad CPAs.

### 2.4 200-Ad Hard Limit Silently Truncates Analysis
- **Description:** At `page.tsx:513`, the fetch call passes `limit=200`. For accounts with hundreds of active ads, the percentile analysis, Pareto insights, and winner hit rate will all be computed on a truncated dataset. The user has no indication that data was truncated.
- **Severity:** Critical
- **File:** `src/app/analytics/ad-perspective/page.tsx:513`
- **Recommendation:** Either (a) show a warning banner when the API returns exactly `limit` results ("Showing top 200 of N ads"), (b) paginate to fetch all ads, or (c) increase the limit. Since the API already paginates internally (`meta-api.ts:308`), increasing to 500+ should work. Also consider adding the total count to the API response.

### 2.5 Date Preset Dropdown Mismatch with getDatePreset
- **Description:** The `<select>` dropdown at `page.tsx:866-876` offers 5 options (7d, 14d, 30d, 60d, 90d) but `getDatePreset` at `page.tsx:84-98` supports 8 options including '6m', '12m', and 'all'. These extra options are unreachable from the UI. Conversely, the default state is `'90d'` which IS in both places, so no bug -- but the '6m' and '12m' code paths are dead code.
- **Severity:** Low
- **File:** `src/app/analytics/ad-perspective/page.tsx:866-876`
- **Recommendation:** Either add the 6m/12m/all options to the dropdown or remove the dead code from `getDatePreset`.

### 2.6 `supabase` Created on Every Render (Outside useMemo)
- **Description:** At `page.tsx:448`, `createClient()` is called at the top of the component body, outside of any hook. This creates a new Supabase client instance on every render.
- **Severity:** Medium
- **File:** `src/app/analytics/ad-perspective/page.tsx:448`
- **Recommendation:** Wrap in `useMemo` or move to a custom hook/context that creates the client once: `const supabase = useMemo(() => createClient(), []);`

### 2.7 Outlier Table Sorts by MetaAdInsight Key but `ad_name` is a String
- **Description:** At `page.tsx:785-789`, the outlier sort casts `a[field]` to `number` for comparison. When `field === 'ad_name'`, this will produce `NaN - NaN = NaN` for every comparison, resulting in undefined sort behavior.
- **Severity:** Medium
- **File:** `src/app/analytics/ad-perspective/page.tsx:785-789`
- **Recommendation:** Add a type check: if `typeof aVal === 'string'`, use `localeCompare` instead of numeric subtraction.

---

## 3. Missing DTC Metrics

### 3.1 No MER (Marketing Efficiency Ratio / Blended ROAS)
- **Description:** MER = total revenue (all channels) / total ad spend. This is the single most important metric for a DTC brand because it accounts for organic, email, and halo effects that platform ROAS misses. The page only shows platform-reported ROAS.
- **Severity:** Critical
- **File:** `src/app/analytics/ad-perspective/page.tsx` (entire page)
- **Recommendation:** Add a MER card at the top of the page. This requires pulling Shopify revenue data (total sales for the period) and dividing by total Meta spend. Consider integrating with the Shopify MCP or a revenue API endpoint.

### 3.2 No AOV (Average Order Value) in Summary
- **Description:** AOV is in the ad detail sidecar (`page.tsx:155`) but not in the summary tables or outlier table. For DTC, AOV trends across ads reveal which creatives attract high-value vs. low-value customers.
- **Severity:** Medium
- **File:** `src/app/analytics/ad-perspective/page.tsx` (outlier table, rank table)
- **Recommendation:** Add AOV as a sortable column in the Outlier Table. It's already computed in `meta-api.ts:708` as `purchaseValue / purchases`.

### 3.3 No Frequency/Fatigue Indicators
- **Description:** Frequency is shown in the ad detail sidecar but there is no account-level frequency analysis or fatigue detection. High frequency (>3) typically signals creative fatigue and rising CPAs.
- **Severity:** Medium
- **File:** `src/app/analytics/ad-perspective/page.tsx`
- **Recommendation:** Add a "Fatigue Watch" section that flags ads with frequency > 3 and declining ROAS over time. This would require requesting `time_increment=1` (daily breakdown) for top ads.

### 3.4 No Hold Rate
- **Description:** The page shows thumbstop/hookrate but not hold rate. Hold rate = video completions / 3-second views, measuring how well the creative retains attention after the hook.
- **Severity:** Low
- **File:** `src/app/analytics/ad-perspective/page.tsx`
- **Recommendation:** Add hold rate to the video metrics in the sidecar: `video_play_100 / video_play_25` (or better, `video_play_100 / 3s_views` once 3s views are fetched per finding 1.2).

### 3.5 No Contribution Margin or nCAC
- **Description:** For DTC analytics, new customer acquisition cost (nCAC) and contribution margin (revenue - COGS - ad spend) are essential for profitability analysis. These require COGS data which may not be available from Meta alone.
- **Severity:** Low
- **File:** N/A
- **Recommendation:** This is a longer-term feature. Consider adding COGS input per brand in settings and computing CM1/CM2 margins. For nCAC, Meta's `action_type: 'omni_purchase'` with `action_target` filtering could help, but Shopify new-vs-returning data is more reliable.

### 3.6 No CPA by Campaign Objective
- **Description:** All ads are analyzed in a single pool regardless of campaign objective (prospecting vs retargeting vs retention). CPA benchmarks differ wildly by objective -- mixing them makes the percentile distribution misleading.
- **Severity:** Medium
- **File:** `src/app/analytics/ad-perspective/page.tsx`
- **Recommendation:** Add a filter/segmentation by campaign objective or name pattern (e.g., campaigns containing "Prospecting" vs "Retargeting"). The campaign_name is already available on each ad insight.

---

## 4. UX Issues

### 4.1 No Loading State After Initial Load (Stale Data Shown During Refetch)
- **Description:** When changing date range or account, the old data remains visible while new data loads. The loading spinner at `page.tsx:906-910` only shows when `loading && ads.length === 0` (first load). On subsequent loads, the user sees stale percentile tables with no indication that data is refreshing.
- **Severity:** Medium
- **File:** `src/app/analytics/ad-perspective/page.tsx:906-910`
- **Recommendation:** Add an overlay or opacity reduction on the data sections during refetch. Change the condition to show a subtle "Updating..." indicator even when previous data exists: `{loading && <div className="absolute inset-0 bg-black/30 flex items-center justify-center z-10">...}`.

### 4.2 Error State Doesn't Offer Retry
- **Description:** The error state at `page.tsx:914-919` shows the error message but has no retry button. The user must manually click the refresh icon.
- **Severity:** Low
- **File:** `src/app/analytics/ad-perspective/page.tsx:914-919`
- **Recommendation:** Add a "Try Again" button in the error state that calls `fetchData()`.

### 4.3 Percentile Table is Not Usable on Mobile
- **Description:** The percentile table has 14 columns. On mobile, `overflow-x-auto` allows scrolling, but the table is extremely wide and the first column (percentile %) scrolls out of view, making it impossible to correlate rows.
- **Severity:** Low
- **File:** `src/app/analytics/ad-perspective/page.tsx:1117-1159`
- **Recommendation:** Add `sticky left-0` positioning to the percentile column so it remains visible while scrolling horizontally.

### 4.4 Ad Detail Sidecar Has No Keyboard Dismiss
- **Description:** The sidecar panel at `page.tsx:210-441` can only be closed by clicking the X button or the backdrop. There is no Escape key handler.
- **Severity:** Low
- **File:** `src/app/analytics/ad-perspective/page.tsx:210`
- **Recommendation:** Add a `useEffect` with a keydown listener for Escape that calls `onClose()`.

---

## 5. Performance

### 5.1 Three Redundant Sort Operations on Same Data
- **Description:** The Pareto insights (`page.tsx:726,739`) re-sort `sortedAds` by revenue and purchases, creating two new sorted copies of the entire array on every render. `chartData` (`page.tsx:770`) creates a third sorted copy.
- **Severity:** Low
- **File:** `src/app/analytics/ad-perspective/page.tsx:726,739,770`
- **Recommendation:** These are inside `useMemo` so they only recompute when deps change, which is acceptable. However, if `sortedAds` grows large (500+), consider pre-computing all three sort orders in a single `useMemo`.

### 5.2 No Caching or Debouncing on Date Range Changes
- **Description:** Every date preset change triggers an immediate full API fetch. Rapidly switching between presets (e.g., user clicking through options) fires multiple concurrent requests.
- **Severity:** Low
- **File:** `src/app/analytics/ad-perspective/page.tsx:525-528`
- **Recommendation:** Add a debounce (300ms) on the `datePreset` effect, or use an `AbortController` to cancel stale requests. Consider caching previous results by key (`${account}_${datePreset}`) in a `useRef` map.

### 5.3 Meta API Response Not Cached Server-Side
- **Description:** The `meta-insights` route at `route.ts` has no server-side caching. Every page load or refresh makes fresh calls to Meta's API, which is slow (multiple paginated requests + media fetches) and subject to rate limiting.
- **Severity:** Medium
- **File:** `src/app/api/meta-insights/route.ts:128`
- **Recommendation:** The page already has `cachedAt` / `isCached` state variables, suggesting caching was planned. Implement a Redis or Supabase cache layer keyed by `(account_id, date_from, date_to)` with a TTL of 15-30 minutes. Return cached data immediately and optionally refresh in the background.

### 5.4 Blob List Called on Every Insights Fetch
- **Description:** At `meta-api.ts:618`, `list({ prefix: 'creatives/', limit: 1000 })` is called every time insights are fetched to check the blob cache. This makes an HTTP call to Vercel Blob storage on every request.
- **Severity:** Medium
- **File:** `src/lib/meta-api.ts:618`
- **Recommendation:** Use an in-memory cache (Map or LRU) for the blob listing, refreshed every 5 minutes. Or store blob URL mappings in Supabase alongside the creative ID.

---

## Prioritized Action Plan

### Immediate (Critical)

| # | Finding | Impact | Effort |
|---|---------|--------|--------|
| 1 | **2.4** 200-ad limit silently truncates analysis | All percentile/Pareto/hit-rate metrics are wrong for large accounts | Low -- increase limit param and add truncation warning |
| 2 | **1.5** Google Ads 14d falls back to 7d | Users see wrong data for 14-day range | Low -- fix the mapping or remove the option |
| 3 | **3.1** No MER/blended ROAS | Missing the #1 DTC metric | Medium -- requires Shopify revenue integration |

### Short-Term (Medium)

| # | Finding | Impact | Effort |
|---|---------|--------|--------|
| 4 | **1.2** Thumbstop uses p25 instead of 3s views | Inaccurate creative performance signal | Low -- add field to API request |
| 5 | **1.3** No attribution window control | Users can't compare attribution models | Medium |
| 6 | **2.6** Supabase client recreated every render | Unnecessary object allocation, potential auth issues | Low -- wrap in useMemo |
| 7 | **2.7** Outlier sort breaks on string column | Undefined sort behavior on ad_name | Low -- add type guard |
| 8 | **3.6** No segmentation by campaign objective | Prospecting and retargeting ads analyzed together | Medium |
| 9 | **4.1** No visual feedback during refetch | Users see stale data without knowing it's updating | Low |
| 10 | **5.3** No server-side caching | Slow loads, Meta rate limiting risk | Medium |
| 11 | **5.4** Blob list on every fetch | Unnecessary network call | Low |
| 12 | **1.4** Campaign type hardcoded | Misclassified campaigns | Low |

### Backlog (Low)

| # | Finding | Impact | Effort |
|---|---------|--------|--------|
| 13 | **2.1** Percentile table is cumulative, not per-bucket | Misleading distribution view | Low -- relabel or recompute |
| 14 | **2.2** Median row calculation quirks | Minor statistical inaccuracy | Low |
| 15 | **2.5** Dead code in date presets | Code cleanliness | Trivial |
| 16 | **3.2** AOV missing from summary tables | Less visibility into order value distribution | Low |
| 17 | **3.3** No frequency/fatigue detection | Missed creative fatigue signals | Medium |
| 18 | **3.4** No hold rate metric | Incomplete video retention analysis | Low |
