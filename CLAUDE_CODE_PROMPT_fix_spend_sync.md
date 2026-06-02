# Claude Code Prompt: Fix P&L Spend Data Being Wiped on Sync

## The Bug

In `src/app/api/shopify-sync/route.ts`, there are two sequential upserts to `daily_pnl`:

1. **Line ~513-531**: Order data upsert — writes `nc_orders`, `nc_revenue`, `rc_orders`, `rc_revenue`, `gross_sales`, `discounts`, `refunds`, `taxes`, `shipping`, `synced_at`. Does NOT include `meta_spend` or `google_spend`.

2. **Line ~723-737**: Ad spend upsert — writes `meta_spend` and `google_spend` for each date.

**The problem:** Supabase's `.upsert()` replaces the entire row on conflict. When the order upsert runs first without spend columns, it resets `meta_spend` and `google_spend` to their column defaults (0) for every date. The ad spend upsert then tries to write spend — but if the Meta token is expired or the API returns empty, those days stay at 0.

This is confirmed by the data: TT's `daily_pnl` shows `meta_spend = 0` and `google_spend = 0` for May 27 onwards, even though orders are syncing fine.

## The Fix

Restructure the sync so spend data is fetched FIRST, then merged into the order rows before the single upsert. This eliminates the two-upsert race condition entirely.

### Changes to `src/app/api/shopify-sync/route.ts`

#### 1. Move the ad spend fetch BEFORE the order upsert

Currently the code flow is:
```
Orders fetch → Order upsert → Spend fetch → Spend upsert
```

Change it to:
```
Orders fetch + Spend fetch (parallel) → Merge → Single upsert
```

Specifically:

**Move the `fetchGoogle` and `fetchMeta` function definitions** (currently around lines 650-707) up so they're defined before the order aggregation section (before line 510).

**Run spend fetches in parallel with order processing.** After `aggregateOrdersByDay(orders)` at line 510, but BEFORE the upsert at line 528, add the spend fetch:

```typescript
const dayBuckets = aggregateOrdersByDay(orders);

// Fetch ad spend in parallel
const adSpendErrors: string[] = [];
let googleDaysSynced = 0;
let metaDaysSynced = 0;

const [dailyGoogle, dailyMeta] = await Promise.all([fetchGoogle(), fetchMeta()]);

// Build order rows WITH spend data merged in
const rows = Array.from(dayBuckets.entries()).map(([date, bucket]) => ({
  brand_id: brand.id,
  date,
  nc_orders: bucket.nc_orders,
  nc_revenue: Math.round(bucket.nc_revenue * 100) / 100,
  rc_orders: bucket.rc_orders,
  rc_revenue: Math.round(bucket.rc_revenue * 100) / 100,
  gross_sales: Math.round(bucket.gross_sales * 100) / 100,
  discounts: Math.round(bucket.discounts * 100) / 100,
  refunds: Math.round(bucket.refunds * 100) / 100,
  taxes: Math.round(bucket.taxes * 100) / 100,
  shipping: Math.round(bucket.shipping * 100) / 100,
  synced_at: new Date().toISOString(),
  // Merge spend data if we have it for this date
  ...(dailyMeta.has(date) ? { meta_spend: Math.round(dailyMeta.get(date)! * 100) / 100 } : {}),
  ...(dailyGoogle.has(date) ? { google_spend: Math.round(dailyGoogle.get(date)! * 100) / 100 } : {}),
}));

googleDaysSynced = dailyGoogle.size;
metaDaysSynced = dailyMeta.size;
```

**Important:** When spend data is NOT available for a date (Meta token expired, API error, etc.), we use spread with empty object `{}` — this means those columns are simply omitted from the upsert row, so Supabase will NOT overwrite existing spend values. Only dates where we successfully fetched spend will update the spend columns.

#### 2. Also handle spend-only dates

Some dates may have ad spend but no orders (e.g., ads running on a day with 0 Shopify orders). After the main order+spend upsert, add a second pass for spend-only dates:

```typescript
// Upsert any spend-only dates (dates with ad spend but no orders)
const orderDates = new Set(dayBuckets.keys());
const spendOnlyRows: any[] = [];
const allSpendDates = new Set([...dailyGoogle.keys(), ...dailyMeta.keys()]);

for (const date of allSpendDates) {
  if (!orderDates.has(date)) {
    spendOnlyRows.push({
      brand_id: brand.id,
      date,
      ...(dailyMeta.has(date) ? { meta_spend: Math.round(dailyMeta.get(date)! * 100) / 100 } : {}),
      ...(dailyGoogle.has(date) ? { google_spend: Math.round(dailyGoogle.get(date)! * 100) / 100 } : {}),
    });
  }
}

if (spendOnlyRows.length > 0) {
  const { error: spendOnlyErr } = await supabase
    .from('daily_pnl')
    .upsert(spendOnlyRows, { onConflict: 'brand_id,date' });
  if (spendOnlyErr) {
    adSpendErrors.push(`Spend-only upsert: ${spendOnlyErr.message}`);
  }
}
```

#### 3. Remove the old separate spend upsert

Delete the old ad spend section that currently runs after the order upsert (around lines 709-738). This was the second upsert that's now merged into the first.

Specifically, remove:
- The old `adSpendByDate` Map construction
- The old `adSpendByDate` upsert block
- But keep the `fetchGoogle` and `fetchMeta` function definitions (just moved earlier)

#### 4. Handle spend-only mode

The `spendOnly` mode (line 406, `action === 'sync_spend_only'`) skips the order fetch. For this mode, the spend upsert should still work as before — it only writes spend columns without touching order columns. This path is fine because it only includes `meta_spend` and `google_spend` in the upsert payload, so it won't zero out order data.

Make sure the spend-only branch still works after the refactor. It should use the same `fetchGoogle()` / `fetchMeta()` functions and do a spend-only upsert (same as current behavior).

#### 5. Move `adSpendErrors` declaration

Currently `adSpendErrors` is declared somewhere around line 648. Move it up to just before the spend fetch calls so it's in scope for both the full-sync and spend-only paths.

### After the fix, also backfill the missing spend data

The last 7 days (May 27 - June 2) have spend = 0 in the database. After deploying the fix, trigger a sync for TT to repopulate. If the Meta token is expired, the sync will log an error — check the response's `ad_spend_errors` field.

## What NOT to change

- Don't change the GET handler
- Don't change the order fetching or aggregation logic
- Don't change the Shopify product sync
- Don't change the shopify_orders upsert
- Don't change the rate limiting or locking logic
- Don't change any database schema

## Verification

After changes:
1. A full sync should produce a single merged upsert to `daily_pnl` with both order AND spend columns
2. If Meta API fails, order data should still upsert without zeroing out existing spend values
3. If Shopify API fails but spend works, spend-only dates should still write
4. The `sync_spend_only` action should still work
5. No TypeScript errors
6. Response JSON should still include `google_spend_days`, `meta_spend_days`, `ad_spend_errors`
