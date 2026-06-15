# Claude Code Prompt: Triple Whale Sync Integration

## Overview
Add Triple Whale as an alternative data source for the daily P&L sync. Brands that have a Triple Whale API key will pull revenue, orders, NC/RC splits, and per-channel ad spend from Triple Whale's Data-Out API instead of connecting to Shopify directly. This eliminates the Shopify app distribution / custom app auth problem for brands where the user is a collaborator (not store owner).

## Why
The current Shopify sync (Path 2: client credentials) requires store-owner-level access to create a custom app and generate client_id + client_secret. For brands where Melch is a collaborator (MTE, Organic Jaguar), this is impossible without the store owner's involvement. Triple Whale already connects to these stores and exposes all the data we need via a simple API key that any user can generate in 30 seconds.

---

## Step 1: Add TRIPLEWHALE_API_KEY env var

This is a single API key that covers all brands the user has access to in Triple Whale. The `shopId` parameter in each API call (the brand's `shopify_store_domain`) determines which store's data is returned.

Add to `.env.local`:
```
TRIPLEWHALE_API_KEY=<key_value>
```

Add to Vercel environment variables (production + preview):
```
TRIPLEWHALE_API_KEY=<key_value>
```

No database migration needed — the key is NOT per-brand.

---

## Step 2: Create `/src/app/api/triplewhale-sync/route.ts`

This is the core sync route. It pulls daily P&L data from Triple Whale's Custom SQL endpoint and upserts into `daily_pnl`.

### Auth & Guard Pattern
Follow the exact same pattern as `/src/app/api/shopify-sync/route.ts`:
- Bearer token auth via Supabase
- Role check: admin or founder
- Request body: `{ brandId: string, startDate?: string, endDate?: string }`
- Default date range: last 7 days if not specified

### Triple Whale API Details

**Base URL:** `https://api.triplewhale.com/api/v2`

**Auth:** `x-api-key` header with `process.env.TRIPLEWHALE_API_KEY`.

**Two API calls per sync:**

#### Call 1: Blended Stats (orders + revenue + NC/RC)

```
POST https://api.triplewhale.com/api/v2/orcabase/api/sql
Headers: { "x-api-key": process.env.TRIPLEWHALE_API_KEY, "Content-Type": "application/json" }
Body: {
  "shopId": brand.shopify_store_domain,
  "query": "SELECT event_date, orders_count, new_customer_orders, new_customer_revenue, gross_product_sales, order_revenue, discounts, refund_money, taxes, shipping_price, spend FROM blended_stats_tvf WHERE event_date BETWEEN @startDate AND @endDate",
  "currency": "USD",
  "period": {
    "startDate": "2025-06-01",
    "endDate": "2025-06-15"
  }
}
```

Response shape:
```json
{
  "success": true,
  "data": [
    {
      "event_date": "2025-06-01",
      "orders_count": 45,
      "new_customer_orders": 30,
      "new_customer_revenue": 4521.50,
      "gross_product_sales": 7890.00,
      "order_revenue": 6543.21,
      "discounts": 1200.00,
      "refund_money": 350.00,
      "taxes": 520.00,
      "shipping_price": 280.00,
      "spend": 1500.00
    }
  ]
}
```

#### Call 2: Per-Channel Ad Spend

```
POST https://api.triplewhale.com/api/v2/orcabase/api/sql
Headers: { "x-api-key": process.env.TRIPLEWHALE_API_KEY, "Content-Type": "application/json" }
Body: {
  "shopId": brand.shopify_store_domain,
  "query": "SELECT event_date, channel, SUM(spend) AS spend FROM ads_table WHERE event_date BETWEEN @startDate AND @endDate GROUP BY event_date, channel",
  "currency": "USD",
  "period": {
    "startDate": "2025-06-01",
    "endDate": "2025-06-15"
  }
}
```

Response shape:
```json
{
  "success": true,
  "data": [
    { "event_date": "2025-06-01", "channel": "facebook-ads", "spend": 800 },
    { "event_date": "2025-06-01", "channel": "google-ads", "spend": 400 },
    { "event_date": "2025-06-01", "channel": "tiktok-ads", "spend": 300 }
  ]
}
```

### Field Mapping: TW → daily_pnl

```typescript
// For each day in the blended stats response:
const row = {
  brand_id: brand.id,
  date: day.event_date,                                                    // "YYYY-MM-DD"
  nc_orders: day.new_customer_orders || 0,
  nc_revenue: round2(day.new_customer_revenue || 0),
  rc_orders: (day.orders_count || 0) - (day.new_customer_orders || 0),
  rc_revenue: round2((day.order_revenue || 0) - (day.new_customer_revenue || 0)),
  gross_sales: round2(day.gross_product_sales || 0),
  discounts: round2(-(day.discounts || 0)),                                // TW stores positive, Melch stores negative
  refunds: round2(-(day.refund_money || 0)),                               // TW stores positive, Melch stores negative
  taxes: round2(day.taxes || 0),
  shipping: round2(day.shipping_price || 0),
  // Spend columns from the per-channel query (see below)
  ...(metaSpendMap.has(day.event_date) ? { meta_spend: round2(metaSpendMap.get(day.event_date)!) } : {}),
  ...(googleSpendMap.has(day.event_date) ? { google_spend: round2(googleSpendMap.get(day.event_date)!) } : {}),
  ...(otherSpendMap.has(day.event_date) ? { other_spend: round2(otherSpendMap.get(day.event_date)!) } : {}),
  synced_at: new Date().toISOString(),
};
```

### Channel Mapping for Spend

```typescript
// From the ads_table response, group spend by channel into three buckets:
const META_CHANNELS = ['facebook-ads'];
const GOOGLE_CHANNELS = ['google-ads'];
// Everything else → other_spend (tiktok-ads, pinterest-ads, snapchat-ads, applovin-ads, etc.)

// Build Maps: date → spend amount
const metaSpendMap = new Map<string, number>();
const googleSpendMap = new Map<string, number>();
const otherSpendMap = new Map<string, number>();

for (const row of adsData) {
  const existing = (map) => map.get(row.event_date) || 0;
  if (META_CHANNELS.includes(row.channel)) {
    metaSpendMap.set(row.event_date, existing(metaSpendMap) + row.spend);
  } else if (GOOGLE_CHANNELS.includes(row.channel)) {
    googleSpendMap.set(row.event_date, existing(googleSpendMap) + row.spend);
  } else {
    otherSpendMap.set(row.event_date, existing(otherSpendMap) + row.spend);
  }
}
```

### Upsert

```typescript
const { error } = await supabase
  .from('daily_pnl')
  .upsert(rows, { onConflict: 'brand_id,date' });
```

Use `Math.round(val * 100) / 100` for all monetary values (same as shopify-sync).

### Error Handling
- If TW returns 429 (rate limited), respect `Retry-After` header
- If TW returns 403, the API key is invalid — return clear error message
- If TW returns empty data array, log warning but don't error
- Wrap each API call in try/catch, return structured error response

### Route Structure

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function POST(req: NextRequest) {
  // 1. Auth check (Bearer token → Supabase user → role check)
  // 2. Parse body: { brandId, startDate?, endDate? }
  // 3. Fetch brand row, verify shopify_store_domain exists + TRIPLEWHALE_API_KEY env var is set
  // 4. Call TW blended_stats_tvf SQL
  // 5. Call TW ads_table SQL
  // 6. Build daily_pnl rows with field mapping
  // 7. Upsert to daily_pnl
  // 8. Return { success: true, daysUpserted: rows.length, dateRange: { start, end } }
}
```

---

## Step 3: Add Triple Whale API Key Field to Team Settings

In `/src/app/team/page.tsx`:

### 3a. Add Sync Button to Team Settings
In the `TeamCard` component settings panel, add a "Sync from Triple Whale" button next to (or below) the existing Shopify sync controls. The button should be visible for any brand that has a `shopify_store_domain` set (since that's the `shopId` used in the API call). The API key is an env var, not per-brand.

```tsx
{/* Triple Whale Sync */}
<div className="flex items-end">
  <button
    onClick={() => triggerTripleWhaleSync(brand.id)}
    disabled={!brand.shopify_store_domain}
    className="px-3 py-1 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 rounded text-xs"
  >
    Sync from Triple Whale
  </button>
</div>
```

### 3b. Add Handler
```typescript
async function triggerTripleWhaleSync(brandId: string) {
  // Same pattern as existing Shopify sync trigger
  // POST /api/triplewhale-sync with { brandId }
  // Show loading state, toast on success/error
}
```

---

## Step 4: No brand-setup changes needed

The API key is an env var (`TRIPLEWHALE_API_KEY`), not a per-brand field. No changes to brand-setup API.

---

## Important Notes

### Revenue Definition Differences
Triple Whale's `new_customer_revenue` uses their `order_revenue` definition (after shipping, taxes, discounts, before refunds). The current Shopify sync uses `subtotal_price + total_discounts` (gross product sales). The TW approach may produce slightly different NC/RC revenue numbers than the Shopify sync does for other brands. This is acceptable — TW's NC/RC classification is actually more reliable because it has its own customer identity resolution rather than relying on Shopify's `customer.orders_count` heuristic.

If exact parity is needed, change the SQL query to use `gross_product_sales` for both NC and RC and compute the split differently. But TW's built-in NC/RC fields are the recommended approach.

### What This Does NOT Replace
- **Product catalog sync**: The `shopify_products` table still needs Shopify API access (client credentials path). Triple Whale's `products_table` exists but may not have variant/image data in the same format. For brands using TW sync, product sync can be deferred or handled separately.
- **shopify_orders table**: The per-order raw data storage is skipped in TW sync. If needed later, TW's `orders_table` via Custom SQL can provide order-level data.
- **Real-time webhooks**: TW sync is pull-based (cron/manual). No order webhooks.

### Rate Limits
Triple Whale allows 100 requests/second, 600/minute. A single sync makes 2 API calls, so rate limiting is not a practical concern for manual or cron-based syncs.

### Data Freshness
Triple Whale data typically lags a few hours behind real-time. For a daily P&L dashboard, this is fine. The sync should default to pulling yesterday's data + today's partial data.

---

## File Changes Summary

| File | Action |
|---|---|
| `src/app/api/triplewhale-sync/route.ts` | NEW - sync route |
| `src/app/team/page.tsx` | EDIT - add TW sync button to settings panel |
