# Campaigns Analytics Page -- Audit Report

**Audited files:**
- `src/app/analytics/campaigns/page.tsx` (frontend, 1228 lines)
- `src/app/api/campaign-metrics/route.ts` (API route, 365 lines)
- `src/lib/supabase.ts` (client factory)

---

## 1. DATA SOURCE & ACCURACY

### 1.1 [Critical] Google Ads `last_14d` maps to `LAST_7_DAYS`
- **File:** `src/app/api/campaign-metrics/route.ts:91`
- **Description:** The `googleRangeMap` maps `'last_14d'` to `'LAST_7_DAYS'` with a `// fallback` comment. This means when a user selects "Last 14 Days", Google Ads data only covers 7 days while Meta data covers 14 days. Blended ROAS, spend, and all cross-platform comparisons are silently wrong for this range.
- **Also duplicated on frontend:** `src/app/analytics/campaigns/page.tsx:92` has an identical `GOOGLE_RANGE_MAP` object but it is never used -- the API route handles the mapping.
- **Recommendation:** Windsor.ai accepts `last_14d` natively (per the `windsorRange` passthrough on line 217). Remove the Google range map entirely from the API route and pass the dateRange directly to Windsor, which already works. Remove the dead `GOOGLE_RANGE_MAP` from the frontend.

### 1.2 [Critical] Meta campaign objective is hardcoded to 'SALES'
- **File:** `src/app/api/campaign-metrics/route.ts:173`
- **Description:** `campaignType: 'SALES'` is hardcoded with the comment "Meta campaigns for this account are all OUTCOME_SALES." The Meta Insights API does not return `campaign.objective` in the requested fields, so the actual objective is never fetched. Any awareness, traffic, or lead-gen campaigns are misrepresented as SALES.
- **Recommendation:** Add `campaign.objective` to the Meta API fields request and map it to `campaignType`. This is essential for grouping Prospecting vs Retargeting campaigns.

### 1.3 [Critical] No use of brand-level `target_roas` or `roas_floor` settings
- **File:** `src/app/analytics/campaigns/page.tsx` (entire file)
- **Description:** Other analytics pages (ad-perspective, efficiency, daily-pnl) fetch `roas_floor`, `target_roas`, and `gross_margin_pct` from the `brands` table and use them for color-coding and threshold lines. This page uses hardcoded thresholds: ROAS card color-codes at 2x/1x (line 764-765), and table row ROAS color-codes at 3x/1.5x (line 1129). These are arbitrary and inconsistent with each other and with other pages.
- **Recommendation:** Fetch brand settings (`target_roas`, `roas_floor`) alongside the brand query and use them for ROAS color-coding. Add a target ROAS reference line on the ROAS chart.

### 1.4 [Medium] Meta API frequency field fetched but never surfaced
- **File:** `src/app/api/campaign-metrics/route.ts:119`
- **Description:** The Meta API request includes `frequency` in the fields list, but it is never extracted, aggregated, or returned in the `CampaignMetric` type. Frequency is a critical fatigue indicator for DTC.
- **Recommendation:** Add `frequency` to the Campaign type and surface it in the table. Flag campaigns with frequency > 3.0.

### 1.5 [Medium] Meta API pagination capped at 500 rows
- **File:** `src/app/api/campaign-metrics/route.ts:120`
- **Description:** `&limit=500` caps results. With `time_increment=1`, each campaign generates one row per day. Over 90 days, 6 campaigns would hit this limit. The Meta API returns a `paging.next` cursor which is never followed.
- **Recommendation:** Implement cursor-based pagination to follow `paging.next` until all data is fetched.

### 1.6 [Medium] Meta campaign status is hardcoded to 'ACTIVE'
- **File:** `src/app/api/campaign-metrics/route.ts:174`
- **Description:** `status: 'ACTIVE'` is hardcoded. The API request does not include `campaign.effective_status` or `campaign.status` in the fields. Paused campaigns with historical spend in the date range will appear as "ACTIVE".
- **Recommendation:** Request `campaign.effective_status` from Meta and pass the real status through.

### 1.7 [Low] Duplicate `extractMetaAction` helper
- **File:** `src/app/analytics/campaigns/page.tsx:115-119` and `src/app/api/campaign-metrics/route.ts:323-327`
- **Description:** The `extractMetaAction` function exists in both the frontend page and the API route. The frontend copy is dead code -- it is defined but never called (the API route handles all Meta data parsing).
- **Recommendation:** Remove the dead copy from `page.tsx`.

### 1.8 [Low] Dead `GOOGLE_RANGE_MAP` constant on frontend
- **File:** `src/app/analytics/campaigns/page.tsx:90-96`
- **Description:** `GOOGLE_RANGE_MAP` is defined but never referenced anywhere in the component. The API route has its own copy.
- **Recommendation:** Delete it.

---

## 2. DTC RELEVANCE

### 2.1 [Critical] No campaign-level frequency metric
- **Description:** Frequency (avg times a user sees the ad) is the primary fatigue signal for DTC brands. The Meta API already fetches it but it is discarded. Google does not natively expose frequency but reach-based estimation could be used.
- **Recommendation:** Surface frequency in the campaign table. Add a "Fatigue Alert" indicator when frequency > 3.0 and ROAS is declining.

### 2.2 [Critical] No scaling vs fatiguing analysis
- **Description:** There is no week-over-week or period-over-period comparison. A strategist cannot see if a campaign's ROAS is trending up or down relative to last period. The daily chart shows raw values but no trend analysis.
- **Recommendation:** Add a "Trend" column to the table showing ROAS direction (comparing first half vs second half of the selected period). Add sparklines per campaign row.

### 2.3 [Medium] Good metric coverage otherwise
- **Description:** The page shows the core DTC metrics: Spend, Revenue, ROAS, Purchases, CPA, CTR, CPC, CPM. The metric breakdown modals with per-platform splits and formulas are excellent. Daily time-series chart with Spend/Revenue, ROAS, and Purchases views is solid.
- **Recommendation:** No change needed for core metrics. Consider adding AOV (Average Order Value = purchaseValue / purchases).

### 2.4 [Medium] No campaign comparison mode
- **Description:** Users can only select one campaign at a time for drill-down. There is no way to overlay two campaigns on the same chart to compare performance.
- **Recommendation:** Allow multi-select on campaign rows and overlay their daily metrics on the drill-down chart.

---

## 3. CAMPAIGN ORGANIZATION

### 3.1 [Critical] No grouping by campaign objective
- **Description:** There is no way to group or filter campaigns by objective (Prospecting, Retargeting, Retention, Brand Awareness). The `campaignType` is hardcoded for Meta (always "SALES") and only shows the Google campaign type. A DTC agency needs to quickly compare prospecting ROAS vs retargeting ROAS.
- **Recommendation:** Fetch real objectives from Meta. Add a filter/group-by dropdown for campaign objective. Show sub-totals per objective group.

### 3.2 [Medium] No status filter (Active/Paused/Archived)
- **Description:** The filter bar has date range and platform toggles but no status filter. Since Meta status is hardcoded to ACTIVE and the page filters out zero-spend campaigns (line 451), paused campaigns with recent spend still show up with no way to distinguish them.
- **Recommendation:** Add a status filter dropdown. Show a status badge in the campaign name column.

### 3.3 [Medium] No budget vs actual spend visibility
- **Description:** The API does not fetch campaign budget (daily or lifetime). Strategists cannot see which campaigns are underspending their budget (delivery issues) or which are maxing out (scaling opportunity).
- **Recommendation:** Fetch `campaign.daily_budget` and `campaign.lifetime_budget` from Meta. Show a budget utilization bar in the table.

---

## 4. CROSS-PLATFORM

### 4.1 [Medium] Cross-platform support is implemented and working
- **Description:** The page fetches both Meta (direct API) and Google Ads (via Windsor.ai) campaigns. The chart splits data by platform. Platform badges and per-platform breakdowns in metric cards are well done.
- **Recommendation:** No critical changes. Consider adding TikTok Ads when relevant.

### 4.2 [Medium] Google Ads data depends on Windsor.ai intermediary
- **File:** `src/app/api/campaign-metrics/route.ts:197-309`
- **Description:** Google Ads data goes through Windsor.ai rather than the Google Ads API directly. Windsor may have data latency or field limitations. The client-side filtering by `account_id` (line 239) suggests Windsor's server-side account filtering is unreliable.
- **Recommendation:** Document Windsor's data latency expectations. Consider migrating to the Google Ads API directly for tighter control. Add a "data freshness" indicator showing when data was last updated.

### 4.3 [Low] Windsor date_preset passthrough may not support all ranges
- **File:** `src/app/api/campaign-metrics/route.ts:217`
- **Description:** `windsorRange` is set to `dateRange` directly (e.g., `last_7d`, `last_14d`). Windsor documentation should be verified to confirm these preset names are supported.
- **Recommendation:** Verify Windsor API accepts `last_14d` and `this_month` as valid presets. If not, compute explicit `date_from`/`date_to` parameters.

---

## 5. UX & PERFORMANCE

### 5.1 [Medium] No search/text filter for campaign names
- **Description:** With many campaigns, there is no way to search by name. Users must scroll through the entire table.
- **Recommendation:** Add a search input that filters campaigns by name. Place it above the table.

### 5.2 [Medium] No pagination for large campaign lists
- **Description:** All campaigns render in a single table. Accounts with 50+ campaigns will have a long, hard-to-navigate table.
- **Recommendation:** Add pagination or virtual scrolling. Show campaign count in the table header.

### 5.3 [Medium] Loading state only shows when campaigns array is empty
- **File:** `src/app/analytics/campaigns/page.tsx:690`
- **Description:** `{fetching && campaigns.length === 0 && ...}` -- when switching date ranges or refreshing, if old data exists, there is no loading indicator. The user sees stale data with no indication that new data is loading.
- **Recommendation:** Add a subtle loading bar or overlay when `fetching` is true regardless of existing data. Consider showing the refresh icon spinning (already done on line 653, which is good).

### 5.4 [Low] Brand dropdown does not close on outside click
- **File:** `src/app/analytics/campaigns/page.tsx:665-683`
- **Description:** The brand dropdown opens on click but only closes when another brand is selected or the button is clicked again. Clicking elsewhere on the page leaves it open.
- **Recommendation:** Add a click-outside handler or use a proper dropdown component.

### 5.5 [Low] Good error and empty state handling
- **Description:** Error states show helpful messages including which ad accounts are missing. Empty state distinguishes between "no brand selected" and "no data for this range." Missing ad account detection (lines 430-436) guides users to Team settings.
- **Recommendation:** No changes needed.

---

## 6. CODE QUALITY

### 6.1 [Medium] Supabase client created on every render
- **File:** `src/app/analytics/campaigns/page.tsx:335`
- **Description:** `const supabase = createClient()` is called at the top of the component function, creating a new client on every render. While `createBrowserClient` may deduplicate internally, this is wasteful and inconsistent with best practices.
- **Recommendation:** Move to a `useMemo` or module-level singleton pattern.

### 6.2 [Medium] useEffect missing dependency: `fetchCampaigns`
- **File:** `src/app/analytics/campaigns/page.tsx:398-401`
- **Description:** The effect depends on `[selectedBrandId, dateRange]` but calls `fetchCampaigns` which closes over `brands`. If `brands` changes after `selectedBrandId` is set, `fetchCampaigns` uses the stale `brands` reference.
- **Recommendation:** Use `useCallback` for `fetchCampaigns` with proper dependencies, or pass the brand directly.

### 6.3 [Low] Large monolithic component (~1228 lines)
- **Description:** The entire page is a single component with inline sub-components. The metric card breakdown data (lines 711-937) is particularly verbose -- 220+ lines of static section definitions.
- **Recommendation:** Extract breakdown section builders into helper functions. Extract the campaign table into its own component.

### 6.4 [Low] Type safety gaps with `any` types
- **File:** `src/app/analytics/campaigns/page.tsx:141` (ChartTooltip), `src/app/api/campaign-metrics/route.ts:130,239,244`
- **Description:** Several `any` types are used for chart tooltip props and API response data.
- **Recommendation:** Define proper types for Recharts tooltip props. Add Windsor and Meta response types.

### 6.5 [Low] Unused imports
- **File:** `src/app/analytics/campaigns/page.tsx:3`
- **Description:** `useRouter` is imported and used only for auth redirect. The `Eye`, `MousePointerClick`, `ShoppingCart`, `Target` icons from lucide-react (lines 14-17) are imported but never used.
- **Recommendation:** Remove unused imports.

---

## 7. INTEGRATION WITH OTHER PAGES

### 7.1 [Critical] No link to Ad Perspective for drill-down
- **Description:** Clicking a campaign row shows a daily chart but there is no way to drill into individual ads within that campaign. The Ad Perspective page exists at `/analytics/ad-perspective` but there is no navigation link from campaigns to it filtered by campaign.
- **Recommendation:** Add a "View Ads" button in the campaign drill-down section that navigates to Ad Perspective filtered by that campaign ID.

### 7.2 [Medium] ROAS thresholds inconsistent with other pages
- **Description:** This page uses hardcoded ROAS thresholds (2x/1x for the metric card, 3x/1.5x for table rows). Ad Perspective and Efficiency pages use the brand's `roas_floor` from the database. This means the same ROAS value could be green on one page and red on another.
- **Recommendation:** Use the brand's `roas_floor` and `target_roas` consistently across all pages. The metric card should color-code relative to target_roas, and table rows relative to roas_floor.

### 7.3 [Low] No link to Daily P&L page
- **Description:** The campaigns page shows revenue but does not link to the Daily P&L page where users can see the same spend data alongside COGS and profit margins.
- **Recommendation:** Add a contextual link or consider showing a gross margin estimate using the brand's `gross_margin_pct`.

---

## PRIORITIZED ACTION PLAN

### P0 -- Data Integrity (fix before relying on this page for decisions)
1. **Fix `last_14d` Google range mapping** -- currently shows 7 days of Google data when 14 is selected (route.ts:91)
2. **Fetch real Meta campaign objective** -- stop hardcoding "SALES" (route.ts:173)
3. **Fetch real Meta campaign status** -- stop hardcoding "ACTIVE" (route.ts:174)
4. **Implement Meta API pagination** -- follow `paging.next` cursor to avoid data truncation at 500 rows (route.ts:120)

### P1 -- DTC Feature Gaps (needed for agency workflow)
5. **Surface frequency metric** -- extract from already-fetched Meta data, add to table
6. **Use brand `target_roas` / `roas_floor`** for ROAS color-coding, consistent with other pages
7. **Add campaign objective grouping/filtering** -- Prospecting vs Retargeting vs Retention
8. **Add campaign status filter** -- Active / Paused / All
9. **Link to Ad Perspective** -- "View Ads" drill-down per campaign

### P2 -- UX Improvements
10. **Add campaign name search** -- text filter above the table
11. **Show loading indicator when refreshing** existing data (not just on first load)
12. **Add budget vs actual spend** -- fetch campaign budgets from Meta
13. **Add period-over-period trending** -- show if ROAS is improving or declining

### P3 -- Code Cleanup
14. **Remove dead code** -- `extractMetaAction` on frontend, `GOOGLE_RANGE_MAP`, unused icon imports
15. **Extract sub-components** -- breakdown builders, campaign table, chart section
16. **Fix Supabase client creation** -- memoize or use singleton
17. **Add proper TypeScript types** -- replace `any` with defined interfaces
