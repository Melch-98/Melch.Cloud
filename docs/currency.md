# Reporting currency foundation

## Model

- **One reporting currency per brand** = Shopify / store settlement currency.
- Source priority: `shopify_stores.shop_info.currency` → majority `shopify_orders.currency` → Meta → Google → USD.
- Do **not** invent brand currencies. Prefer leaving USD only as last-resort default when no Shopify signal exists.

## Shared helpers

- `src/lib/currency.ts` — `getFxRates`, `toReportingCurrency` / `toBase`, `resolveReportingCurrency`, `currencyFromShopInfo`
- `src/lib/format.ts` — `makeFmt(code)` for display
- FX: `https://open.er-api.com/v6/latest/USD` (USD pivot), 1h cache, static fallback (CAD 1.38, …) — same source BFCM/Geo already used

## Persistence

- Migration: `supabase/migration-daily-pnl-currency.sql` adds `daily_pnl.currency`
- `shopify-sync` converts Meta/Google spend into reporting currency **before** upsert and tags `currency`
- Upsert retries without `currency` if the column is not migrated yet

## Page status

| Surface | Status |
|---------|--------|
| Daily P&L | Fixed — ISO chip + formatters; spend converted at sync |
| BFCM | Fixed — default AUTO → Shopify settlement |
| Geo Performance | Already converted (now uses shared FX helpers) |
| Ad Perspective | Already `makeFmt` (Meta account currency) |
| Campaigns | Fixed — API converts Meta→reporting; UI uses reporting symbol. Google native FX still TODO when Google currency ≠ reporting |
| Efficiency / LTV / Forecast | TODO — still hardcode `$`; backed by `daily_pnl` so after re-sync spend is in reporting currency but labels may say `$` |
| Triple Whale sync | Passes reporting currency into TW SQL; **residual**: TW channel spend may still be native/USD-ish depending on TW; prefer Shopify sync for spend |

## Residual risk — CAD Tallow Twins

- Historical `daily_pnl` rows may predate conversion/tagging. Re-run Shopify sync (or spend-only) after deploying migration.
- If Meta ad account is already CAD and revenue is CAD, pre-fix rows may already be correct; if Meta was USD against CAD revenue, MER/aMER/CM were wrong until re-sync.
- BFCM localStorage `bfcm_base_currency=USD` overrides AUTO — clear it once to pick up CAD.
