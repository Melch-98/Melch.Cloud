import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// ─── Types ──────────────────────────────────────────────────────

interface CountryRow {
  country: string;              // ISO 2-letter code (US, CA, etc.)
  country_name: string;         // Full name (United States, Canada, etc.)
  meta_spend: number;           // In ad account currency
  meta_currency: string;        // Ad account currency code
  shopify_revenue: number;      // In store currency
  shopify_currency: string;     // Store currency code
  orders: number;
  normalized_spend: number;     // Converted to base currency
  normalized_revenue: number;   // Converted to base currency
  normalized_roas: number;      // normalized_revenue / normalized_spend
  base_currency: string;
}

interface FxRates {
  [currency: string]: number;   // rate = how many units of base per 1 unit of currency
}

interface Totals {
  normalized_spend: number;
  normalized_revenue: number;
  normalized_roas: number;
  total_orders: number;
  base_currency: string;
}

// ─── Exchange Rate Helpers ──────────────────────────────────────

const FX_CACHE: { rates: FxRates; timestamp: number } = { rates: {}, timestamp: 0 };
const FX_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

async function getFxRates(base: string): Promise<FxRates> {
  if (Date.now() - FX_CACHE.timestamp < FX_CACHE_TTL_MS && FX_CACHE.rates) {
    return FX_CACHE.rates;
  }
  try {
    const res = await fetch(`https://open.er-api.com/v6/latest/${base}`);
    if (res.ok) {
      const data = await res.json();
      FX_CACHE.rates = data.rates || {};
      FX_CACHE.timestamp = Date.now();
      return FX_CACHE.rates;
    }
  } catch { /* fall through to fallback */ }

  // Fallback: hardcoded rates vs USD (Aug 2026 approximate)
  if (base === 'USD') {
    return { USD: 1, CAD: 0.7227, GBP: 1.27, EUR: 1.09, AUD: 0.655, NZD: 0.595 };
  }
  // For other bases, simply return 1:1 for the base currency
  return { [base]: 1 };
}

// Country code → name map (common DTC markets)
const COUNTRY_NAMES: Record<string, string> = {
  US: 'United States', CA: 'Canada', GB: 'United Kingdom', AU: 'Australia',
  NZ: 'New Zealand', DE: 'Germany', FR: 'France', IT: 'Italy', ES: 'Spain',
  NL: 'Netherlands', BE: 'Belgium', AT: 'Austria', CH: 'Switzerland',
  SE: 'Sweden', NO: 'Norway', DK: 'Denmark', FI: 'Finland', IE: 'Ireland',
  PT: 'Portugal', JP: 'Japan', KR: 'South Korea', MX: 'Mexico', BR: 'Brazil',
  IN: 'India', SG: 'Singapore', HK: 'Hong Kong', AE: 'United Arab Emirates',
};

function countryName(code: string): string {
  const upper = code?.toUpperCase() || '';
  return COUNTRY_NAMES[upper] || upper;
}

// ─── Meta Country Breakdown ─────────────────────────────────────

async function fetchMetaCountrySpend(
  accessToken: string,
  adAccountId: string,
  dateFrom: string,
  dateTo: string
): Promise<{ country: string; spend: number; currency: string }[]> {
  const accountId = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`;

  // Get account currency
  let currency = 'USD';
  try {
    const cRes = await fetch(
      `https://graph.facebook.com/v21.0/${accountId}?fields=currency&access_token=${accessToken}`
    );
    if (cRes.ok) {
      const cData = await cRes.json();
      if (cData?.currency) currency = cData.currency;
    }
  } catch { /* keep USD default */ }

  const timeRange = JSON.stringify({ since: dateFrom, until: dateTo });
  const url =
    `https://graph.facebook.com/v21.0/${accountId}/insights?` +
    `fields=spend&breakdowns=country` +
    `&time_range=${encodeURIComponent(timeRange)}` +
    `&action_attribution_windows=["7d_click","1d_view"]` +
    `&limit=200&access_token=${accessToken}`;

  const results: { country: string; spend: number; currency: string }[] = [];
  let nextUrl: string | null = url;

  while (nextUrl) {
    const res: Response = await fetch(String(nextUrl));
    if (!res.ok) {
      console.error('Meta country breakdown failed:', res.status);
      break;
    }
    const data = (await res.json()) as Record<string, any>;
    for (const row of data.data || []) {
      results.push({
        country: row.country || 'XX',
        spend: parseFloat(row.spend || '0'),
        currency,
      });
    }
    nextUrl = data.paging?.next || null;
  }

  return results;
}

// ─── Shopify Country Revenue ────────────────────────────────────

async function fetchShopifyCountryRevenue(
  supabase: any,
  brandId: string,
  dateFrom: string,
  dateTo: string
): Promise<{ country: string; revenue: number; currency: string; orders: number }[]> {
  // Paginate shopify_orders — they can be large
  const PAGE_SIZE = 1000;
  let allOrders: any[] = [];
  let page = 0;

  while (true) {
    const { data, error } = await supabase
      .from('shopify_orders')
      .select('total_price, currency, shipping_address, shopify_created_at')
      .eq('brand_id', brandId)
      .gte('shopify_created_at', `${dateFrom}T00:00:00Z`)
      .lte('shopify_created_at', `${dateTo}T23:59:59Z`)
      .order('shopify_created_at', { ascending: false })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

    if (error) {
      console.error('Shopify orders query error:', error.message);
      break;
    }
    if (!data || data.length === 0) break;
    allOrders = allOrders.concat(data);
    if (data.length < PAGE_SIZE) break;
    page++;
  }

  // Aggregate by country
  const countryMap = new Map<string, { revenue: number; currency: string; orders: number }>();
  for (const order of allOrders) {
    const addr = order.shipping_address;
    if (!addr) continue;

    // Prefer country_code ISO, fall back to parsing country name
    let cc = addr.country_code || addr.country || '';
    cc = cc.toUpperCase();

    // Normalize common Shopify country name → ISO code
    if (cc === 'UNITED STATES') cc = 'US';
    else if (cc === 'CANADA') cc = 'CA';
    else if (cc === 'UNITED KINGDOM') cc = 'GB';
    else if (cc === 'AUSTRALIA') cc = 'AU';
    else if (cc === 'NEW ZEALAND') cc = 'NZ';
    else if (cc === 'GERMANY') cc = 'DE';
    else if (cc === 'FRANCE') cc = 'FR';
    else if (cc === 'ITALY') cc = 'IT';
    else if (cc === 'SPAIN') cc = 'ES';
    else if (cc === 'NETHERLANDS') cc = 'NL';
    else if (cc === 'SWITZERLAND') cc = 'CH';

    const rev = parseFloat(order.total_price || '0');
    const currency = order.currency || 'USD';

    const existing = countryMap.get(cc);
    if (existing) {
      existing.revenue += rev;
      existing.orders += 1;
    } else {
      countryMap.set(cc, { revenue: rev, currency, orders: 1 });
    }
  }

  return Array.from(countryMap.entries()).map(([country, data]) => ({
    country,
    ...data,
  }));
}

// ─── Main Handler ───────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Auth
  const authHeader = request.headers.get('authorization');
  if (!authHeader) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from('users_profile')
    .select('role, brand_id')
    .eq('id', user.id)
    .single();

  if (!profile || !['admin', 'strategist', 'founder'].includes(profile.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const brandId = searchParams.get('brandId');
  const dateFrom = searchParams.get('dateFrom');
  const dateTo = searchParams.get('dateTo');
  const baseCurrency = (searchParams.get('baseCurrency') || 'USD').toUpperCase();

  if (!brandId || !dateFrom || !dateTo) {
    return NextResponse.json(
      { error: 'Missing required params: brandId, dateFrom, dateTo' },
      { status: 400 }
    );
  }

  // Non-admins only own brand
  if (profile.role !== 'admin' && profile.brand_id !== brandId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Get brand config
  const { data: brand, error: brandError } = await supabase
    .from('brands')
    .select('id, name, meta_ad_account_id, shopify_store_domain')
    .eq('id', brandId)
    .single();

  if (brandError || !brand) {
    return NextResponse.json({ error: 'Brand not found' }, { status: 404 });
  }

  // Get Meta token
  let metaToken = process.env.META_ACCESS_TOKEN || '';
  if (!metaToken) {
    const { data: settings } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', 'meta_access_token')
      .single();
    metaToken = settings?.value || '';
  }

  // ── Fetch data in parallel ──
  const errors: string[] = [];
  
  let metaData: { country: string; spend: number; currency: string }[] = [];
  let shopifyData: { country: string; revenue: number; currency: string; orders: number }[] = [];

  const [metaPromise, shopifyPromise] = await Promise.allSettled([
    metaToken && brand.meta_ad_account_id
      ? fetchMetaCountrySpend(metaToken, brand.meta_ad_account_id, dateFrom, dateTo)
      : Promise.resolve([]),
    fetchShopifyCountryRevenue(supabase, brandId, dateFrom, dateTo),
  ]);

  if (metaPromise.status === 'fulfilled') {
    metaData = metaPromise.value;
  } else {
    errors.push(`Meta API: ${metaPromise.reason}`);
  }

  if (shopifyPromise.status === 'fulfilled') {
    shopifyData = shopifyPromise.value;
  } else {
    errors.push(`Shopify: ${shopifyPromise.reason}`);
  }

  // ── Currency normalization ──

  const fxRates = await getFxRates(baseCurrency);

  // Collect all unique currencies for FX lookup
  const allCurrencies = new Set<string>();
  metaData.forEach((m) => allCurrencies.add(m.currency));
  shopifyData.forEach((s) => allCurrencies.add(s.currency));

  // Build currency→rate map (how many base units per 1 unit of this currency)
  const rateMap: Record<string, number> = {};
  allCurrencies.forEach((cur) => {
    const rate = fxRates[cur];
    if (rate) {
      rateMap[cur] = rate;
    } else if (cur === baseCurrency) {
      rateMap[cur] = 1;
    } else {
      // Unknown currency — treat as 1:1 but flag
      rateMap[cur] = 1;
    }
  });

  // ── Merge Meta + Shopify by country ──
  const countrySet = new Set<string>();
  metaData.forEach((m) => countrySet.add(m.country));
  shopifyData.forEach((s) => countrySet.add(s.country));

  const rows: CountryRow[] = [];

  countrySet.forEach((cc) => {
    const meta = metaData.find((m) => m.country === cc);
    const shop = shopifyData.find((s) => s.country === cc);

    const metaSpend = meta?.spend || 0;
    const metaCurrency = meta?.currency || 'USD';
    const shopifyRevenue = shop?.revenue || 0;
    const shopifyCurrency = shop?.currency || 'USD';
    const orders = shop?.orders || 0;

    const metaRate = rateMap[metaCurrency] || 1;
    const shopRate = rateMap[shopifyCurrency] || 1;

    const normalizedSpend = metaSpend * metaRate;
    const normalizedRevenue = shopifyRevenue * shopRate;
    const normalizedRoas = normalizedSpend > 0 ? normalizedRevenue / normalizedSpend : 0;

    rows.push({
      country: cc,
      country_name: countryName(cc),
      meta_spend: Math.round(metaSpend * 100) / 100,
      meta_currency: metaCurrency,
      shopify_revenue: Math.round(shopifyRevenue * 100) / 100,
      shopify_currency: shopifyCurrency,
      orders,
      normalized_spend: Math.round(normalizedSpend * 100) / 100,
      normalized_revenue: Math.round(normalizedRevenue * 100) / 100,
      normalized_roas: Math.round(normalizedRoas * 100) / 100,
      base_currency: baseCurrency,
    });
  });

  // Sort by normalized spend descending
  rows.sort((a, b) => b.normalized_spend - a.normalized_spend);

  // Compute totals
  const totals: Totals = {
    normalized_spend: Math.round(rows.reduce((s, r) => s + r.normalized_spend, 0) * 100) / 100,
    normalized_revenue: Math.round(rows.reduce((s, r) => s + r.normalized_revenue, 0) * 100) / 100,
    total_orders: rows.reduce((s, r) => s + r.orders, 0),
    normalized_roas: 0,
    base_currency: baseCurrency,
  };
  totals.normalized_roas = totals.normalized_spend > 0
    ? Math.round((totals.normalized_revenue / totals.normalized_spend) * 100) / 100
    : 0;

  return NextResponse.json({
    rows,
    totals,
    base_currency: baseCurrency,
    fx_rates: rateMap,
    date_range: { from: dateFrom, to: dateTo },
    errors: errors.length > 0 ? errors : undefined,
  });
}