# Kleio Daily P&L (Tallow Twins test)

Temporary Melch.Cloud surface while Shopify/Triple-Whale `daily_pnl` is rebuilt.

## What shipped

- Route: `/analytics/daily-pnl-kleio` — visible to **admin + founder**, gated to **Tallow Twins** (`slug === tallow-twins`, id `b992a5bd-c87a-4e26-b9c6-a8efbd0a822a`).
- API: `GET /api/kleio-pnl` — same auth/brand gate. Reporting currency defaults to **CAD**.
- Hero layout (competitive brief): **CM → Net sales / orders / AOV → Total spend → MER + aMER → NC/RC**. Channel spend is subordinate; platform ROAS labeled **“platform, not bank.”**
- Melch chrome: `#0a0a0a` + `#c8b89a`.

## Hidden from founders (admins keep access)

Temporary while P&L rebuild / Kleio test:

| Surface | Path |
|---------|------|
| Daily P&L (Shopify/TW) | `/analytics/daily-pnl` |
| BFCM Command Center | `/analytics/bfcm-pacing` |
| Campaigns | `/analytics/campaigns` |
| Geo Performance | `/analytics/geo-performance` |
| Efficiency Curve | `/analytics/efficiency` |
| LTV Cohorts | `/analytics/ltv-cohorts` |
| Forecast | `/analytics/forecast` |
| Ad Perspective (Shopify MER mix) | `/analytics/ad-perspective` |

Navbar roles + client redirects (and API role checks where applicable) block founders hitting URLs directly. Strategists keep prior access where they already had it (BFCM, campaigns, geo, ad-perspective).

## Kleio connectivity (honest status)

Kleio store analytics ([getkleio.com](https://getkleio.com)) documents an **MCP** endpoint:

```
https://app.getkleio.com/api/mcp
```

Auth is **OAuth for MCP clients** (Claude / Cursor chat). That is **not** available inside the Next.js browser or as a drop-in server REST client without a long-lived API key.

There is **no published P&L REST OpenAPI** for Melch to proxy in this PR. Do **not** pretend the browser can call MCP.

## Wiring live data later (server-side)

Set on the host (Vercel / Corsair env) — **never commit secrets**:

| Env | Purpose |
|-----|---------|
| `KLEIO_API_KEY` | Bearer token for a future Kleio HTTP API |
| `KLEIO_API_BASE_URL` | Base URL |
| `KLEIO_PNL_PATH` | Optional path (default `/api/v1/pnl`) |

Until both key + base URL are set, `/api/kleio-pnl` returns structured stub with `status: "kleio_not_configured"` (HTTP 503).

When configured, `src/lib/kleio.ts` calls:

`GET {KLEIO_API_BASE_URL}{KLEIO_PNL_PATH}?start=&end=&brand_slug=tallow-twins`

and maps `{ hero, timeseries, currency }` into the UI.

## Hard rules

- Do **not** write Kleio numbers into `daily_pnl`.
- Keep this page Tallow Twins–only until the rebuild is validated.
