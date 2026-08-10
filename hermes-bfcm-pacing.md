# Hermes Prompt: Build BFCM Pacing Dashboard

## Context

Build a new analytics page at `/analytics/bfcm-pacing` that shows live spend pacing for Black Friday / Cyber Monday. This is a critical planning and monitoring tool — media buyers need to see whether today's hourly spend is on track vs recent baselines AND vs last year's BFCM performance, all in one view.

**Reference:** The screenshot in this repo's context shows a pacing dashboard with hourly spend curves, L7 average comparison, and projected daily total. We're building something similar but BFCM-specific, with YoY comparison layered in.

## Files to create

- `src/app/analytics/bfcm-pacing/page.tsx` — the main page component
- `src/app/api/bfcm-pacing/route.ts` — API route that fetches and shapes pacing data

## Files to modify

- `src/components/Navbar.tsx` — add nav link for BFCM Pacing under Analytics

**Do NOT modify:**
- `src/lib/meta-api.ts` — use it as-is for reference, but the pacing API route fetches its own data
- Any other existing analytics pages
- Any API routes not listed above

## Design system

Match existing Melch.Cloud dark theme:
- Background: `#0A0A0A` (page), `#111111` (cards)
- Text: `#F5F5F8` (primary), `#ABABAB` (secondary)
- Accent: `#C8B89A` (gold — buttons, highlights, active states)
- Borders: `rgba(255,255,255,0.06)` to `rgba(255,255,255,0.12)`
- Border radius: `rounded-xl` for cards, `rounded-lg` for inputs/buttons
- Use Tailwind utility classes + inline styles

## Data source

Meta Marketing API v21.0. The API route should:

1. Get the brand's `meta_ad_account_id` from the `brands` table (same pattern as `src/app/api/campaign-metrics/route.ts`)
2. Get the Meta access token from env or `app_settings` (same pattern)
3. Fetch account-level insights (not campaign-level) with `time_increment=1` for daily and hourly breakdowns
4. Also fetch the account currency via the `fetchAccountCurrency` function from `src/lib/meta-api.ts` — display values in the correct currency symbol (USD=$, CAD=CA$, GBP=£, EUR=€)

### API route: `/api/bfcm-pacing`

**Query params:**
- `brandId` (required)
- `year` (optional, defaults to current year) — which BFCM to show
- `mode` (optional: `live` | `review`, defaults to `live`) — live shows today's hourly pacing, review shows completed days

**Response shape:**
```json
{
  "currency": "USD",
  "bfcmWindow": {
    "start": "2026-11-23",
    "end": "2026-11-30"
  },
  "today": {
    "date": "2026-11-27",
    "dayLabel": "Black Friday",
    "hourlySpend": [
      { "hour": 0, "spend": 120.50 },
      { "hour": 1, "spend": 95.30 }
    ],
    "totalSpendSoFar": 27500,
    "projectedTotal": 54100
  },
  "l7Baseline": {
    "hourlyAvg": [
      { "hour": 0, "spend": 80.20 },
      { "hour": 1, "spend": 72.10 }
    ],
    "dailyAvg": 35700
  },
  "lastYearBfcm": {
    "sameDay": {
      "dayLabel": "Black Friday",
      "date": "2025-11-28",
      "totalSpend": 42000,
      "hourlySpend": [
        { "hour": 0, "spend": 100.00 }
      ]
    },
    "fullWindow": [
      { "date": "2025-11-24", "dayLabel": "Monday", "spend": 18000 },
      { "date": "2025-11-25", "dayLabel": "Tuesday", "spend": 20000 }
    ]
  },
  "thisYearBfcm": {
    "fullWindow": [
      { "date": "2026-11-23", "dayLabel": "Monday", "spend": 19500 },
      { "date": "2026-11-24", "dayLabel": "Tuesday", "spend": 22000 }
    ]
  }
}
```

### BFCM date calculation

BFCM is anchored to US Thanksgiving (4th Thursday of November). The pacing window is **Monday before Thanksgiving through Cyber Monday** (8 days). Calculate dynamically:

```typescript
function getBfcmWindow(year: number) {
  // Find 4th Thursday of November
  const nov1 = new Date(year, 10, 1); // November
  let thursdayCount = 0;
  let thanksgiving: Date | null = null;
  for (let d = 1; d <= 30; d++) {
    const date = new Date(year, 10, d);
    if (date.getDay() === 4) {
      thursdayCount++;
      if (thursdayCount === 4) {
        thanksgiving = date;
        break;
      }
    }
  }
  // Monday before Thanksgiving = Thanksgiving - 3 days
  const mondayBefore = new Date(thanksgiving!);
  mondayBefore.setDate(mondayBefore.getDate() - 3);
  // Cyber Monday = day after Sunday after Thanksgiving = Thanksgiving + 4
  const cyberMonday = new Date(thanksgiving!);
  cyberMonday.setDate(cyberMonday.getDate() + 4);
  
  return { start: mondayBefore, end: cyberMonday, thanksgiving: thanksgiving! };
}
```

### Hourly data from Meta

To get hourly breakdowns for today, use the `time_increment` parameter with value `"all_days"` and add `breakdowns=hourly_stats_aggregated_by_advertiser_time_zone`:

```
GET /{ad_account_id}/insights?
  level=account&
  time_range={"since":"2026-11-27","until":"2026-11-27"}&
  breakdowns=hourly_stats_aggregated_by_advertiser_time_zone&
  fields=spend,impressions,clicks&
  access_token={token}
```

This returns rows with `hourly_stats_aggregated_by_advertiser_time_zone` field like `"00:00:00 - 00:59:59"` which you parse to extract the hour number.

For the L7 baseline hourly average, fetch the last 7 days with the same hourly breakdown and average each hour across the 7 days.

For last year's BFCM, fetch daily data for the corresponding BFCM window of the previous year using `time_increment=1`.

### Projection logic

Projected daily total = `(spendSoFar / l7HourlySpendUpToThisHour) * l7DailyAvg`

In other words: if you've spent 51.2% more than the L7 average by this hour, project the full day at 51.2% above L7 daily average.

## Page layout

```
┌─────────────────────────────────────────────────────────────────┐
│  BFCM Pacing                          [Brand selector] [Year]  │
│  Live spend pace — today vs L7 baseline and last year's BFCM   │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────┐ ┌──────────────┐ ┌──────────┐ ┌───────────────┐ │
│  │ SPEND    │ │ L7 AVG BY    │ │ VS L7    │ │ PROJECTED     │ │
│  │ SO FAR   │ │ THIS HOUR    │ │ PACE     │ │ TODAY         │ │
│  │ $27.5K   │ │ $18.2K       │ │ +51.2%   │ │ $54.1K        │ │
│  │          │ │              │ │          │ │ L7 avg $35.7K │ │
│  └──────────┘ └──────────────┘ └──────────┘ └───────────────┘ │
│                                                                 │
│  ┌──────────────┐ ┌──────────────┐                             │
│  │ VS LAST YEAR │ │ LAST YEAR    │                             │
│  │ SAME DAY     │ │ SAME DAY     │                             │
│  │ +30.5%       │ │ $42.0K       │                             │
│  └──────────────┘ └──────────────┘                             │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │  HOURLY SPEND CURVE                                        ││
│  │                                                             ││
│  │  Three lines:                                               ││
│  │   — Today (solid gold #C8B89A, thick)                      ││
│  │   — L7 average (gray, medium)                              ││
│  │   — Last year same day (dashed, lighter gray)              ││
│  │                                                             ││
│  │  X-axis: 0:00–23:00                                        ││
│  │  Y-axis: cumulative spend                                  ││
│  │  Vertical dashed line at current hour                      ││
│  │  Projected portion of today's line = dotted gold           ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                 │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │  BFCM WINDOW — DAILY BREAKDOWN                             ││
│  │                                                             ││
│  │  Bar chart: 8 days (Mon–Cyber Mon)                         ││
│  │  Each day has two bars side by side:                        ││
│  │   — This year (gold)                                       ││
│  │   — Last year (gray)                                       ││
│  │  Future days show projected spend (gold, lower opacity)    ││
│  │                                                             ││
│  │  Day labels: Mon, Tue, Wed, Thu (🦃), Fri (BF), Sat,      ││
│  │              Sun, Mon (CM)                                  ││
│  │                                                             ││
│  │  Summary row below chart:                                   ││
│  │   Window total: $XXX,XXX  |  Last year: $XXX,XXX  |  YoY  ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                 │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │  DAILY TABLE (collapsible)                                  ││
│  │  Date | Day | This Year | Last Year | YoY % | Cumulative   ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

## KPI cards (top row)

Six cards in a responsive grid (`grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4`):

1. **Spend So Far** — today's actual spend, large number
2. **L7 Avg by This Hour** — what the L7 average was at this same hour, with "same-hour baseline" subtitle
3. **vs L7 Pace** — percentage difference, green if above, red if below (or vice versa depending on context — more spend isn't always good, so use neutral gold color)
4. **Projected Today** — extrapolated daily total, with "L7 daily avg $X" subtitle
5. **vs Last Year Same Day** — percentage difference vs same BFCM day last year
6. **Last Year Same Day** — last year's total spend for the equivalent BFCM day

Each card: `bg-[#111111]` background, `rounded-xl`, `p-5`, label in `text-xs uppercase tracking-wider text-[#ABABAB]`, value in `text-2xl font-semibold text-[#F5F5F8]`.

## Hourly spend curve chart

Use Recharts (already a project dependency). Three `<Line>` series on a `<LineChart>`:

1. **Today** — solid line, stroke `#C8B89A`, strokeWidth 2.5
2. **L7 Average** — solid line, stroke `#666666`, strokeWidth 1.5
3. **Last Year Same Day** — dashed line, stroke `#888888`, strokeWidth 1.5, strokeDasharray `"5 5"`

Data should be **cumulative** spend (running total by hour), not per-hour increments. This makes the curves always go up and the visual comparison is clearer.

Add a `<ReferenceLine>` at the current hour (vertical dashed line, stroke `rgba(200,184,154,0.4)`).

For projected hours (current hour to 23): extend today's line as a dotted gold line using a separate `<Line>` series with strokeDasharray.

Chart container: `bg-[#111111] rounded-xl p-6`, height 350px.

## BFCM window daily bar chart

Use Recharts `<BarChart>` with grouped bars:

- Two `<Bar>` per day: this year (fill `#C8B89A`) and last year (fill `#444444`)
- Future days this year: fill `rgba(200,184,154,0.4)` to indicate projected
- X-axis labels: day name + special labels for Thanksgiving (Thu 🦃), Black Friday (Fri BF), Cyber Monday (Mon CM)
- Summary stats below the chart in a flex row

Chart container: `bg-[#111111] rounded-xl p-6`, height 300px.

## Navbar integration

Add the BFCM Pacing link in Navbar.tsx under Analytics submenu. Use the `Zap` icon from lucide-react. Roles: `['admin', 'strategist', 'founder']`.

Place it after the Campaigns link in the Analytics submenu.

## Auth & permissions

Follow the same auth pattern as `src/app/api/campaign-metrics/route.ts`:
- Verify bearer token via Supabase auth
- Check `users_profile` role is admin, strategist, or founder
- Non-admins can only fetch their own brand

## Currency handling

Call `fetchAccountCurrency(accountId, accessToken)` from `src/lib/meta-api.ts` to get the account's currency code. Map to symbol for display:

```typescript
const currencySymbols: Record<string, string> = {
  USD: '$', CAD: 'CA$', GBP: '£', EUR: '€', AUD: 'A$',
};
const symbol = currencySymbols[currency] || currency + ' ';
```

Pass the currency code and symbol in the API response so the frontend formats values correctly.

## Error states

- No Meta ad account configured → show setup prompt
- No data for current BFCM window (too early in the year) → show countdown to BFCM with the calculated dates
- No last year data available → show this year only, hide YoY cards
- API error → show error banner with retry button

## Caching

Cache the API response in-memory for 5 minutes (same pattern as `src/app/api/meta-insights/route.ts` which uses a 15-minute cache). BFCM pacing should be fresher since it's a live monitoring tool.

## Mobile responsiveness

- KPI cards: 2 columns on mobile, 3 on tablet, 6 on desktop
- Charts: full width, reduce height to 250px on mobile
- Daily table: horizontal scroll on mobile

## Preserve existing functionality

This is a net-new page. Don't modify or break any existing analytics pages. The API route is completely independent.

## Testing checklist

After implementation, verify:
- [ ] Page loads at `/analytics/bfcm-pacing` with correct auth
- [ ] KPI cards show correct values with proper currency symbol
- [ ] Hourly curve renders three lines (today, L7, last year)
- [ ] Current hour marker shows correctly
- [ ] Projected line extends from current hour to end of day
- [ ] Daily bar chart shows this year vs last year
- [ ] Future days show as projected (lower opacity)
- [ ] BFCM window dates calculate correctly for current year
- [ ] Last year's BFCM dates calculate correctly
- [ ] Currency displays correctly (not hardcoded to $)
- [ ] Works for brands with no last-year data (graceful fallback)
- [ ] Error states display correctly
- [ ] Navbar link appears for admin/strategist/founder roles
- [ ] Mobile layout is usable
