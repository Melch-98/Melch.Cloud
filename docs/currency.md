# Reporting currency foundation

## Model

- **One reporting currency per brand** = Shopify / store settlement currency.
- Source priority when tagging a sync: `shopify_stores.shop_info.currency` → majority `shopify_orders.currency` → Meta → Google → USD.
- BFCM reads the newest tagged `daily_pnl.currency` first. Active brands have no `shopify_stores` row, so shop info alone falls through to USD.
- Do **not** invent brand currencies. Prefer leaving USD only as last-resort default when no Shopify signal exists.
- Applies to **every brand**, not a single store. UI labels and FX conversion must work for CAD, USD, GBP, EUR, etc.

## Shared helpers

- `src/lib/currency.ts` — `getFxRates`, `toReportingCurrency` / `toBase`, `resolveReportingCurrency`, `currencyFromShopInfo`, `normalizeCurrencyCode`
- `src/lib/format.ts` — `makeFmt(code)` for display (`symbol`, `currencyFull`, compact helpers)
- `src/lib/pipeboard-google.ts` — `fetchGoogleAdsCurrency` (GAQL `customer.currency_code`) for Google ↔ reporting FX
- FX: `https://open.er-api.com/v6/latest/USD` (USD pivot), 1h cache, static fallback (CAD 1.38, …) — same source BFCM/Geo already used

## Persistence

- Migration: `supabase/migration-daily-pnl-currency.sql` adds `daily_pnl.currency`
- `shopify-sync` converts Meta/Google spend into reporting currency **before** upsert and tags `currency`
- Upsert retries without `currency` if the column is not migrated yet
- Operators: apply the migration in prod, then **re-sync all brands** (not one brand) so historical spend is converted + tagged

## Page / API contract

| Surface | Status |
|---------|--------|
| Daily P&L | Fixed — ISO chip + formatters; spend converted at sync |
| BFCM | Store currency is the newest `daily_pnl.currency` (active brands have no `shopify_stores` row), then shop info, then USD. AUTO displays that currency. Sales and the aMER strip stay in store currency; live Meta and Google spend convert from the ad account. |
| Geo Performance | Already converted (shared FX helpers) |
| Ad Perspective | `makeFmt` (Meta account currency) |
| Campaigns | Fixed — Meta **and** Google native → reporting FX in `/api/campaign-metrics`; UI uses reporting symbol (incl. chart ticks) |
| Triple Whale sync | Orders and other-channel spend still come from TW SQL in the reporting currency. When `fetchDailyAdSpend` returns `metaOk`, `meta_spend` is Meta's own daily spend (0 on days with no spend) instead of TW `facebook-ads`. A failed Meta fetch keeps the TW value. Google follows that same success rule. Those amounts are the ad-account daily totals, the same figures Shopify sync converts when the account currency differs from settlement. |

## Residual risks

- Historical `daily_pnl` rows may predate conversion/tagging until migration + re-sync.
- If Meta/Google ad account currency already matches store settlement, pre-fix rows may already be coherent; mismatched pairs (e.g. USD ads vs CAD revenue) were wrong until re-sync.
- BFCM `localStorage bfcm_base_currency=USD` overrides AUTO — clear once to pick up store settlement.
- Client pages that read `daily_pnl` resolve display currency as: tagged `daily_pnl.currency` → `shopify_stores.shop_info` → USD.
