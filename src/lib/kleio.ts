/**
 * Kleio P&L server client (Tallow Twins test).
 *
 * IMPORTANT:
 * - Kleio's public store-analytics product (getkleio.com) documents MCP + OAuth only:
 *   https://app.getkleio.com/api/mcp — chat/agent side, NOT callable from the browser
 *   and not usable as a Next.js server REST client without a long-lived API key.
 * - There is no published P&L REST OpenAPI for Melch to proxy today.
 * - Wire server-side later via KLEIO_API_KEY + KLEIO_API_BASE_URL (and optional
 *   KLEIO_PNL_PATH). Do NOT write Kleio numbers into daily_pnl.
 */

export const TALLOW_TWINS_BRAND_ID = 'b992a5bd-c87a-4e26-b9c6-a8efbd0a822a';
export const TALLOW_TWINS_SLUG = 'tallow-twins';

export type KleioPeriod = 'mtd' | 'last_7' | 'last_30' | 'custom';

export interface KleioPnLRequest {
  brandId: string;
  period: KleioPeriod;
  startDate?: string; // YYYY-MM-DD
  endDate?: string;   // YYYY-MM-DD
}

export interface KleioHeroMetric {
  key: string;
  label: string;
  value: number | null;
  format: 'currency' | 'percent' | 'number' | 'ratio';
  hint?: string;
  /** UI section: primary hero order from competitive brief */
  section?: 'cm' | 'sales' | 'spend' | 'efficiency' | 'nc_rc' | 'channel' | 'platform';
}

export interface KleioTimeseriesPoint {
  date: string;
  revenue: number | null;
  contribution_margin: number | null;
  ad_spend: number | null;
  orders: number | null;
}

export interface KleioPnLPayload {
  brand_id: string;
  brand_slug: string;
  period: KleioPeriod;
  start_date: string;
  end_date: string;
  currency: string;
  source: 'kleio' | 'stub';
  status: 'ok' | 'kleio_not_configured' | 'kleio_upstream_error';
  message?: string;
  hero: KleioHeroMetric[];
  timeseries: KleioTimeseriesPoint[];
}

function env(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : undefined;
}

export function isTallowTwinsBrand(brandId: string | null | undefined, slug?: string | null): boolean {
  if (brandId && brandId === TALLOW_TWINS_BRAND_ID) return true;
  if (slug && slug === TALLOW_TWINS_SLUG) return true;
  return false;
}

export function isKleioConfigured(): boolean {
  return !!(env('KLEIO_API_KEY') && env('KLEIO_API_BASE_URL'));
}

export function resolveDateRange(
  period: KleioPeriod,
  startDate?: string,
  endDate?: string,
  now = new Date()
): { start: string; end: string } {
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const end = endDate && period === 'custom' ? endDate : iso(now);
  if (period === 'custom' && startDate && endDate) {
    return { start: startDate, end: endDate };
  }
  const start = new Date(now);
  if (period === 'mtd') {
    start.setUTCDate(1);
  } else if (period === 'last_7') {
    start.setUTCDate(start.getUTCDate() - 6);
  } else if (period === 'last_30') {
    start.setUTCDate(start.getUTCDate() - 29);
  } else if (period === 'custom' && startDate) {
    return { start: startDate, end };
  }
  return { start: iso(start), end };
}

function emptyHero(): KleioHeroMetric[] {
  // Order: CM → Net sales/orders/AOV → Total spend → MER + aMER → NC/RC.
  // Channel spend dollars subordinate; platform ROAS labeled “platform, not bank.”
  return [
    { key: 'contribution_margin', label: 'Contribution Margin', value: null, format: 'currency', section: 'cm', hint: 'After COGS + variable costs' },
    { key: 'cm_pct', label: 'CM %', value: null, format: 'percent', section: 'cm' },
    { key: 'net_sales', label: 'Net Sales', value: null, format: 'currency', section: 'sales' },
    { key: 'orders', label: 'Orders', value: null, format: 'number', section: 'sales' },
    { key: 'aov', label: 'AOV', value: null, format: 'currency', section: 'sales' },
    { key: 'total_spend', label: 'Total Spend', value: null, format: 'currency', section: 'spend', hint: 'All paid channels' },
    { key: 'mer', label: 'MER', value: null, format: 'ratio', section: 'efficiency', hint: 'Net sales ÷ total spend' },
    { key: 'amer', label: 'aMER', value: null, format: 'ratio', section: 'efficiency', hint: 'NC revenue ÷ total spend' },
    { key: 'nc_revenue', label: 'NC Revenue', value: null, format: 'currency', section: 'nc_rc' },
    { key: 'rc_revenue', label: 'RC Revenue', value: null, format: 'currency', section: 'nc_rc' },
    { key: 'nc_orders', label: 'NC Orders', value: null, format: 'number', section: 'nc_rc' },
    { key: 'rc_orders', label: 'RC Orders', value: null, format: 'number', section: 'nc_rc' },
    { key: 'meta_spend', label: 'Meta Spend', value: null, format: 'currency', section: 'channel' },
    { key: 'google_spend', label: 'Google Spend', value: null, format: 'currency', section: 'channel' },
    { key: 'other_spend', label: 'Other Spend', value: null, format: 'currency', section: 'channel' },
    { key: 'meta_roas', label: 'Meta ROAS', value: null, format: 'ratio', section: 'platform', hint: 'Platform reported — not bank' },
    { key: 'google_roas', label: 'Google ROAS', value: null, format: 'ratio', section: 'platform', hint: 'Platform reported — not bank' },
  ];
}

export function stubPayload(
  brandId: string,
  period: KleioPeriod,
  range: { start: string; end: string },
  status: KleioPnLPayload['status'],
  message: string
): KleioPnLPayload {
  return {
    brand_id: brandId,
    brand_slug: TALLOW_TWINS_SLUG,
    period,
    start_date: range.start,
    end_date: range.end,
    currency: 'CAD',
    source: 'stub',
    status,
    message,
    hero: emptyHero(),
    timeseries: [],
  };
}

/**
 * Fetch Kleio P&L if server credentials exist.
 * Expected contract when Nick wires HTTP:
 *   GET {KLEIO_API_BASE_URL}{KLEIO_PNL_PATH}?start=YYYY-MM-DD&end=YYYY-MM-DD
 *   Authorization: Bearer {KLEIO_API_KEY}
 * Response should map into KleioPnLPayload fields (hero + timeseries).
 */
export async function fetchKleioPnL(req: KleioPnLRequest): Promise<KleioPnLPayload> {
  const range = resolveDateRange(req.period, req.startDate, req.endDate);

  if (!isTallowTwinsBrand(req.brandId)) {
    return stubPayload(
      req.brandId,
      req.period,
      range,
      'kleio_not_configured',
      'Kleio P&L test is Tallow Twins only.'
    );
  }

  const apiKey = env('KLEIO_API_KEY');
  const baseUrl = env('KLEIO_API_BASE_URL');
  const path = env('KLEIO_PNL_PATH') || '/api/v1/pnl';

  if (!apiKey || !baseUrl) {
    return stubPayload(
      req.brandId,
      req.period,
      range,
      'kleio_not_configured',
      'Kleio HTTP credentials not configured. MCP at app.getkleio.com is chat-side OAuth only — set KLEIO_API_KEY + KLEIO_API_BASE_URL on the server to wire live P&L. Do not write Kleio into daily_pnl.'
    );
  }

  const url = new URL(path, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
  url.searchParams.set('start', range.start);
  url.searchParams.set('end', range.end);
  url.searchParams.set('brand_slug', TALLOW_TWINS_SLUG);

  try {
    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
      },
      cache: 'no-store',
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return stubPayload(
        req.brandId,
        req.period,
        range,
        'kleio_upstream_error',
        `Kleio upstream ${res.status}: ${body.slice(0, 300) || res.statusText}`
      );
    }

    const data = await res.json();
    // Accept either our shape or a thin wrapper { hero, timeseries, currency }
    const hero = Array.isArray(data.hero) ? data.hero : emptyHero();
    const timeseries = Array.isArray(data.timeseries) ? data.timeseries : [];
    return {
      brand_id: req.brandId,
      brand_slug: TALLOW_TWINS_SLUG,
      period: req.period,
      start_date: range.start,
      end_date: range.end,
      currency: data.currency || 'CAD',
      source: 'kleio',
      status: 'ok',
      message: data.message,
      hero,
      timeseries,
    };
  } catch (err: any) {
    return stubPayload(
      req.brandId,
      req.period,
      range,
      'kleio_upstream_error',
      err?.message || 'Kleio request failed'
    );
  }
}
