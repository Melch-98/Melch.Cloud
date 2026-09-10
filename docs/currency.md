# Reporting currency foundation

## Model

- **One reporting currency per brand** = Shopify / store settlement currency.
- Source priority: `shopify_stores.shop_info.currency` → majority `shopify_orders.currency` → Meta → Google → USD.
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
| BFCM | Fixed — default AUTO → Shopify settlement |
| Geo Performance | Already converted (shared FX helpers) |
| Ad Perspective | `makeFmt` (Meta account currency) |
| Campaigns | Fixed — Meta **and** Google native → reporting FX in `/api/campaign-metrics`; UI uses reporting symbol (incl. chart ticks) |
| Efficiency | Fixed — reporting chip + `makeFmt` symbol; backed by `daily_pnl` |
| LTV Cohorts | Fixed — same |
| Forecast | Fixed — same |
| Triple Whale sync | Passes reporting currency into TW SQL; **prefer Shopify sync for spend truth** (TW channel spend may still be native/USD-ish depending on TW) |

## Residual risks

- Historical `daily_pnl` rows may predate conversion/tagging until migration + re-sync.
- If Meta/Google ad account currency already matches store settlement, pre-fix rows may already be coherent; mismatched pairs (e.g. USD ads vs CAD revenue) were wrong until re-sync.
- BFCM `localStorage bfcm_base_currency=USD` overrides AUTO — clear once to pick up store settlement.
- Client pages that read `daily_pnl` resolve display currency as: tagged `daily_pnl.currency` → `shopify_stores.shop_info` → USD.
