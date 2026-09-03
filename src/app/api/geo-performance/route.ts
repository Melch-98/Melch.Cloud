import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { gaqlQuery, normalizeCustomerId } from '@/lib/pipeboard-google';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// ─── Types ──────────────────────────────────────────────────────

interface CampaignRow {
  campaign_id: string;
  campaign_name: string;
  campaign_type: string;
  status: string;
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  purchases: number;
  purchase_value: number;
  roas: number;
  aov: number;
  cpa: number;
  meta_currency: string;
  normalized_spend: number;
  normalized_revenue: number;
  normalized_roas: number;
  spend_rank: number;
  raw_country: string;
}

interface CountryRow {
  country: string;
  country_name: string;
  flag: string;
  // Meta (account currency)
  meta_spend: number;
  meta_purchases: number;
  meta_purchase_value: number;
  meta_roas: number;
  meta_currency: string;
  // Google (account currency)
  google_spend: number;
  google_currency: string;
  // Shopify (store currency)
  shopify_revenue: number;
  shopify_nc_revenue: number;
  shopify_currency: string;
  shopify_orders: number;
  shopify_nc_orders: number;
  shopify_connected: boolean;
  // Normalized to base
  normalized_spend: number;          // Meta spend in base
  normalized_google_spend: number;   // Google spend in base
  normalized_total_spend: number;    // Meta + Google in base
  normalized_revenue: number;
  normalized_nc_revenue: number;
  normalized_roas: number;
  // KB metrics
  nc_aov: number | null;
  ncac: number | null;               // total spend ÷ NC orders
  amer: number | null;               // NC revenue ÷ total spend
  inc_roas: number;
  roas_vs_amer_gap: number | null;
  spend_rank: number;
  amer_rank: number;
  spend_efficiency: 'over' | 'healthy' | 'under';
  campaigns: CampaignRow[];
  campaign_count: number;
  spend_share: number;
  cta: string | null;
}

interface GeoResponse {
  countries: CountryRow[];
  totals: {
    normalized_meta_spend: number;
    normalized_google_spend: number;
    normalized_spend: number;        // total (meta + google)
    normalized_revenue: number;
    normalized_nc_revenue: number;
    meta_roas: number;
    normalized_roas: number;
    amer: number | null;
    inc_roas: number;
    total_orders: number;
    total_nc_orders: number;
    total_purchases: number;
    base_currency: string;
    country_count: number;
    campaign_count: number;
    brand_gross_margin_pct: number;
    if_factor: number;
    shopify_connected: boolean;
    google_connected: boolean;
  };
  baseCurrency: string;
  shopify_currency: string;
  meta_currency: string;
  google_currency: string;
  fxRates: Record<string, number>;
  date_range: { from: string; to: string };
  errors?: string[];
  warnings?: string[];
}

// ─── Constants ──────────────────────────────────────────────────
const IF_FACTOR = 1.38;

// Google Ads geo criterion ID → ISO country code.
// Only LOCATION_OF_PRESENCE (physical location) is used — it matches Shopify
// shipping country and Meta delivery country.
const GOOGLE_GEO_TO_ISO: Record<string, string> = {
  '2124': 'CA', // Canada
  '2840': 'US', // United States
  '2826': 'GB', // United Kingdom
  '2036': 'AU', // Australia
  '2276': 'DE', // Germany
  '2250': 'FR', // France
  '2380': 'IT', // Italy
  '2724': 'ES', // Spain
  '2528': 'NL', // Netherlands
  '2756': 'CH', // Switzerland
  '2752': 'SE', // Sweden
  '2578': 'NO', // Norway
  '2208': 'DK', // Denmark
  '2246': 'FI', // Finland
  '2392': 'JP', // Japan
  '2410': 'KR', // South Korea
  '2484': 'MX', // Mexico
  '2076': 'BR', // Brazil
  '2702': 'SG', // Singapore
  '2344': 'HK', // Hong Kong
  '2784': 'AE', // United Arab Emirates
};

// ─── Helpers ────────────────────────────────────────────────────

function extractMetaAction(actions: any[] | undefined, actionType: string): number {
  if (!actions) return 0;
  const candidates = actionType === 'purchase'
    ? ['purchase', 'omni_purchase', 'offsite_conversion.fb_pixel_purchase']
    : [actionType];
  for (const t of candidates) {
    const found = actions.find((a: any) => a.action_type === t);
    if (found) return parseFloat(found.value);
  }
  return 0;
}

function fmtDate(d: Date): string { return d.toISOString().split('T')[0]; }

function dateRangeToMeta(range: string): { since: string; until: string } {
  const now = new Date();
  // "Last N days" = N FULL days ending yesterday (the last complete day).
  // This matches the bfcm-pacing route and the daily meta_report.py convention.
  // Yesterday avoids the partial-today distortion and gives stable numbers.
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const until = fmtDate(yesterday);
  // since = N days before until. Both since and until are inclusive, so
  // since = yesterday - (N - 1) gives exactly N days.
  const daysFor = (n: number): string => {
    const d = new Date(yesterday);
    d.setDate(d.getDate() - (n - 1));
    return fmtDate(d);
  };
  switch (range) {
    case 'last_7d': return { since: daysFor(7), until };
    case 'last_14d': return { since: daysFor(14), until };
    case 'last_30d': return { since: daysFor(30), until };
    case 'last_90d': return { since: daysFor(90), until };
    case 'this_month': return { since: fmtDate(new Date(now.getFullYear(), now.getMonth(), 1)), until: fmtDate(now) };
    default: return { since: daysFor(30), until };
  }
}

const COUNTRY_NAMES: Record<string, string> = {
  US: 'United States', CA: 'Canada', GB: 'United Kingdom', AU: 'Australia',
  NZ: 'New Zealand', DE: 'Germany', FR: 'France', IT: 'Italy', ES: 'Spain',
  NL: 'Netherlands', BE: 'Belgium', AT: 'Austria', CH: 'Switzerland',
  SE: 'Sweden', NO: 'Norway', DK: 'Denmark', FI: 'Finland', IE: 'Ireland',
  PT: 'Portugal', JP: 'Japan', KR: 'South Korea', MX: 'Mexico', BR: 'Brazil',
  SG: 'Singapore', HK: 'Hong Kong', AE: 'United Arab Emirates',
};
const COUNTRY_FLAGS: Record<string, string> = {
  US: '🇺🇸', CA: '🇨🇦', GB: '🇬🇧', AU: '🇦🇺', NZ: '🇳🇿',
  DE: '🇩🇪', FR: '🇫🇷', IT: '🇮🇹', ES: '🇪🇸', NL: '🇳🇱',
  BE: '🇧🇪', AT: '🇦🇹', CH: '🇨🇭', SE: '🇸🇪', NO: '🇳🇴',
  DK: '🇩🇰', FI: '🇫🇮', IE: '🇮🇪', PT: '🇵🇹', JP: '🇯🇵',
  KR: '🇰🇷', MX: '🇲🇽', BR: '🇧🇷', SG: '🇸🇬', HK: '🇭🇰', AE: '🇦🇪',
};

function countryName(code: string): string { return COUNTRY_NAMES[code?.toUpperCase()] || code?.toUpperCase() || code; }
function countryFlag(code: string): string { return COUNTRY_FLAGS[code?.toUpperCase()] || '🌐'; }

function normShopifyCountry(addr: any): string {
  if (!addr) return '';
  let cc = ((addr.country_code || addr.country) as string || '').toUpperCase().trim();
  const m: Record<string, string> = {
    'UNITED STATES': 'US', 'CANADA': 'CA', 'UNITED KINGDOM': 'GB', 'AUSTRALIA': 'AU',
    'NEW ZEALAND': 'NZ', 'GERMANY': 'DE', 'FRANCE': 'FR', 'ITALY': 'IT', 'SPAIN': 'ES',
    'NETHERLANDS': 'NL', 'SWITZERLAND': 'CH', 'SWEDEN': 'SE', 'NORWAY': 'NO', 'DENMARK': 'DK',
    'FINLAND': 'FI', 'IRELAND': 'IE', 'PORTUGAL': 'PT', 'JAPAN': 'JP', 'SOUTH KOREA': 'KR',
    'MEXICO': 'MX', 'BRAZIL': 'BR', 'SINGAPORE': 'SG',
  };
  return m[cc] || cc;
}

function classObj(obj: string): string {
  const u = (obj || '').toUpperCase();
  if (u.includes('SALES') || u.includes('CONVERSIONS') || u.includes('TRAFFIC') || u.includes('LEAD') || u.includes('APP_PROMOTION')) return 'Demand Capture';
  if (u.includes('AWARENESS') || u.includes('REACH') || u.includes('VIDEO_VIEWS')) return 'Demand Creation';
  return 'Demand Capture';
}

// ─── FX (USD pivot) ─────────────────────────────────────────────
const FX_CACHE: { rates: Record<string, number>; ts: number } = { rates: {}, ts: 0 };
async function getFxRates(): Promise<Record<string, number>> {
  if (Date.now() - FX_CACHE.ts < 3600000 && Object.keys(FX_CACHE.rates).length > 0) return FX_CACHE.rates;
  try {
    const res: Response = await fetch('https://open.er-api.com/v6/latest/USD');
    if (res.ok) {
      const d = (await res.json()) as any;
      if (d?.rates) { FX_CACHE.rates = d.rates; FX_CACHE.ts = Date.now(); return FX_CACHE.rates; }
    }
  } catch { /* fall through to static per-USD rates */ }
  FX_CACHE.rates = { USD: 1, CAD: 1.38, GBP: 0.73, EUR: 0.86, AUD: 1.55, NZD: 1.70 };
  FX_CACHE.ts = Date.now();
  return FX_CACHE.rates;
}

// rates[cur] = units of `cur` per 1 USD.
// value_base = value_native × rates[base] / rates[native]
function toBase(v: number, native: string, base: string, rates: Record<string, number>): number {
  if (!native || native === base) return v;
  const rNative = rates[native];
  const rBase = rates[base];
  if (!rNative || !rBase) return v;
  return v * rBase / rNative;
}

// ─── Fetch Meta campaign × country ──────────────────────────────

async function fetchMetaGeo(
  token: string, adAccountId: string, since: string, until: string
): Promise<{ rows: any[]; currency: string; cInfo: Record<string, { obj: string; status: string }>; errors: string[] }> {
  const errors: string[] = [];
  const acct = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`;

  let currency = 'USD';
  try {
    const cr = await fetch(`https://graph.facebook.com/v21.0/${acct}?fields=currency&access_token=${token}`);
    if (cr.ok) { const cd: any = await cr.json(); if (cd?.currency) currency = cd.currency; }
  } catch {}

  const tr = encodeURIComponent(JSON.stringify({ since, until }));
  const fields = 'campaign_id,campaign_name,spend,impressions,clicks,reach,actions,action_values';
  const baseUrl =
    `https://graph.facebook.com/v21.0/${acct}/insights?` +
    `level=campaign&breakdowns=country` +
    `&time_range=${tr}&action_attribution_windows=["7d_click","1d_view"]` +
    `&fields=${fields}&limit=500&access_token=${token}`;

  const allRows: any[] = [];
  let nextUrl: string | null = baseUrl;

  try {
    while (nextUrl) {
      const res = await fetch(String(nextUrl));
      if (!res.ok) break;
      const page: any = await res.json();
      if (page.error) { errors.push(`Meta: ${page.error.message}`); break; }
      if (page.data) allRows.push(...page.data);
      nextUrl = page.paging?.next || null;
    }
  } catch (e: any) { errors.push(`Meta fetch: ${e.message}`); }

  const cSet = new Set<string>();
  allRows.forEach((r: any) => { if (r.campaign_id) cSet.add(r.campaign_id); });
  const cIds = Array.from(cSet);
  const cInfo: Record<string, { obj: string; status: string }> = {};

  if (cIds.length > 0) {
    try {
      for (let i = 0; i < cIds.length; i += 50) {
        const chunk = cIds.slice(i, i + 50);
        const mr = await fetch(`https://graph.facebook.com/v21.0/?ids=${chunk.join(',')}&fields=objective,effective_status&access_token=${token}`);
        if (mr.ok) {
          const mi: any = await mr.json();
          for (const [cid, info] of Object.entries(mi as Record<string, any>)) {
            cInfo[cid] = { obj: (info as any).objective || 'UNKNOWN', status: (info as any).effective_status || 'UNKNOWN' };
          }
        }
      }
    } catch {}
  }

  return { rows: allRows, currency, cInfo, errors };
}

// ─── Fetch Google Ads geo spend ─────────────────────────────────
// geographic_view with LOCATION_OF_PRESENCE = where the user physically is.
// Matches Shopify shipping country and Meta delivery country.

async function fetchGoogleGeo(
  token: string, customerId: string, since: string, until: string
): Promise<{ byCountry: Map<string, number>; currency: string; errors: string[] }> {
  const errors: string[] = [];
  const custId = normalizeCustomerId(customerId);
  if (!custId) return { byCountry: new Map(), currency: 'USD', errors: ['No Google customer ID'] };

  // Account currency
  let currency = 'USD';
  try {
    const curRows = await gaqlQuery(token, custId, 'SELECT customer.currency_code, customer.id FROM customer LIMIT 1');
    if (curRows?.[0]?.customer?.currencyCode) currency = curRows[0].customer.currencyCode;
  } catch (e: any) { errors.push(`Google currency: ${e.message}`); }

  // Geo spend by country (LOCATION_OF_PRESENCE)
  const query =
    `SELECT geographic_view.country_criterion_id, geographic_view.location_type, metrics.cost_micros ` +
    `FROM geographic_view WHERE segments.date BETWEEN "${since}" AND "${until}"`;

  const byCountry = new Map<string, number>();
  try {
    const rows = await gaqlQuery(token, custId, query);
    for (const r of rows) {
      const gv = r?.geographicView;
      if (!gv || gv.locationType !== 'LOCATION_OF_PRESENCE') continue;
      const iso = GOOGLE_GEO_TO_ISO[gv.countryCriterionId] || 'XX';
      const cost = Number(r?.metrics?.costMicros || '0') / 1_000_000;
      byCountry.set(iso, (byCountry.get(iso) || 0) + cost);
    }
  } catch (e: any) { errors.push(`Google geo: ${e.message}`); }

  return { byCountry, currency, errors };
}

// ─── Fetch Shopify by country with NC/RC ───────────────────────

async function fetchShopifyByCountry(
  supabase: any, brandId: string, since: string, until: string
): Promise<{ byCountry: Map<string, { rev: number; ncRev: number; cur: string; ord: number; ncOrd: number }>; hasData: boolean }> {
  const PS = 1000;
  interface Ord { shopify_order_id: number; customer_id: number | null; shipping_address: any; total_price: string; currency: string; shopify_created_at: string; }

  const allOrds: Ord[] = [];
  let pg = 0;
  while (true) {
    const { data, error } = await supabase
      .from('shopify_orders')
      .select('shopify_order_id, customer_id, shipping_address, total_price, currency, shopify_created_at')
      .eq('brand_id', brandId)
      .gte('shopify_created_at', `${since}T00:00:00Z`)
      .lte('shopify_created_at', `${until}T23:59:59Z`)
      .order('shopify_created_at', { ascending: true })
      .range(pg * PS, (pg + 1) * PS - 1);
    if (error || !data || data.length === 0) break;
    allOrds.push(...(data as Ord[]));
    if (data.length < PS) break;
    pg++;
  }

  if (allOrds.length === 0) return { byCountry: new Map(), hasData: false };

  const custSet = new Set<number>();
  allOrds.forEach((o: Ord) => { if (o.customer_id) custSet.add(o.customer_id); });
  const cIds = Array.from(custSet);
  const firstOrder = new Map<number, string>();

  if (cIds.length > 0) {
    for (let i = 0; i < cIds.length; i += 100) {
      const chunk = cIds.slice(i, i + 100);
      const { data: co } = await supabase
        .from('shopify_orders')
        .select('customer_id, shopify_created_at')
        .eq('brand_id', brandId)
        .in('customer_id', chunk)
        .order('shopify_created_at', { ascending: true });
      if (co) {
        for (const c of co) {
          const cid = c.customer_id as number;
          const ts = c.shopify_created_at as string;
          if (!firstOrder.has(cid) || ts < firstOrder.get(cid)!) firstOrder.set(cid, ts);
        }
      }
    }
  }

  const byCountry = new Map<string, { rev: number; ncRev: number; cur: string; ord: number; ncOrd: number }>();
  for (const o of allOrds) {
    const cc = normShopifyCountry(o.shipping_address);
    if (!cc) continue;
    const rev = parseFloat(o.total_price || '0');
    const cur = o.currency || 'USD';
    let isNC = false;
    if (!o.customer_id) { isNC = true; }
    else {
      const ft = firstOrder.get(o.customer_id);
      if (ft) { isNC = Math.abs(new Date(o.shopify_created_at).getTime() - new Date(ft).getTime()) < 1000; }
      else { isNC = true; }
    }
    const ex = byCountry.get(cc);
    if (ex) { ex.rev += rev; if (isNC) { ex.ncRev += rev; ex.ncOrd += 1; } ex.ord += 1; }
    else { byCountry.set(cc, { rev, ncRev: isNC ? rev : 0, cur, ord: 1, ncOrd: isNC ? 1 : 0 }); }
  }
  return { byCountry, hasData: true };
}

// ─── Classify efficiency ────────────────────────────────────────

function classify(spendRank: number, amerRank: number, amer: number | null): { eff: 'over' | 'healthy' | 'under'; cta: string | null } {
  if (amer === null) return { eff: 'healthy', cta: null };
  const d = spendRank - amerRank;
  if (d >= 2 && amer < 1.0) return { eff: 'over', cta: 'Reduce or pause' };
  if (d >= 2) return { eff: 'over', cta: 'Cut lowest-ROAS campaigns' };
  if (d <= -2 && amer >= 1.5) return { eff: 'under', cta: 'Scale — room to increase' };
  if (amer >= 2.0) return { eff: 'under', cta: 'Strong: test higher spend' };
  return { eff: 'healthy', cta: null };
}

// ─── Main Handler ───────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  const authHeader = request.headers.get('authorization');
  if (!authHeader) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile } = await supabase.from('users_profile').select('role, brand_id').eq('id', user.id).single();
  if (!profile || !['admin', 'strategist', 'founder'].includes(profile.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const brandId = searchParams.get('brandId');
  const dateRange = searchParams.get('dateRange') || 'last_30d';
  const baseCurrencyOverride = (searchParams.get('baseCurrency') || '').toUpperCase();
  if (!brandId) return NextResponse.json({ error: 'brandId required' }, { status: 400 });
  if (profile.role !== 'admin' && profile.brand_id !== brandId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { data: brand, error: brandErr } = await supabase
    .from('brands')
    .select('id, name, meta_ad_account_id, shopify_store_domain, gross_margin_pct, google_ads_customer_id')
    .eq('id', brandId)
    .single();
  if (brandErr || !brand) return NextResponse.json({ error: 'Brand not found' }, { status: 404 });

  let metaToken = process.env.META_ACCESS_TOKEN || '';
  if (!metaToken) {
    const { data: s } = await supabase.from('app_settings').select('value').eq('key', 'meta_access_token').single();
    metaToken = s?.value || '';
  }

  let pipeboardToken = process.env.PIPEBOARD_API_TOKEN || '';
  if (!pipeboardToken) {
    const { data: s } = await supabase.from('app_settings').select('value').eq('key', 'pipeboard_api_token').single();
    pipeboardToken = s?.value || '';
  }

  const { since, until } = dateRangeToMeta(dateRange);
  const errors: string[] = [];
  const warnings: string[] = [];
  const grossMarginPct = brand.gross_margin_pct || 60;

  // ── Fetch all three sources in parallel ──

  const [metaR, shopR, googleR] = await Promise.allSettled([
    metaToken && brand.meta_ad_account_id
      ? fetchMetaGeo(metaToken, brand.meta_ad_account_id, since, until)
      : Promise.resolve({ rows: [], currency: 'USD', cInfo: {} as Record<string, { obj: string; status: string }>, errors: ['No Meta config'] }),
    fetchShopifyByCountry(supabase, brandId, since, until),
    pipeboardToken && brand.google_ads_customer_id
      ? fetchGoogleGeo(pipeboardToken, brand.google_ads_customer_id, since, until)
      : Promise.resolve({ byCountry: new Map<string, number>(), currency: 'USD', errors: ['No Google config'] }),
  ]);

  let metaRows: any[] = [];
  let metaCurrency = 'USD';
  let cInfo: Record<string, { obj: string; status: string }> = {};

  if (metaR.status === 'fulfilled') {
    metaRows = metaR.value.rows; metaCurrency = metaR.value.currency; cInfo = metaR.value.cInfo;
    errors.push(...metaR.value.errors);
  } else { errors.push(`Meta: ${String(metaR.reason)}`); }

  const shopMap = shopR.status === 'fulfilled' ? shopR.value.byCountry : new Map<string, { rev: number; ncRev: number; cur: string; ord: number; ncOrd: number }>();
  const shopHasData = shopR.status === 'fulfilled' ? shopR.value.hasData : false;
  if (shopR.status === 'rejected') errors.push(`Shopify: ${String(shopR.reason)}`);
  if (!shopHasData) warnings.push('No Shopify order data — aMER unavailable. Shopify sync may be needed.');

  const googleMap = googleR.status === 'fulfilled' ? googleR.value.byCountry : new Map<string, number>();
  let googleCurrency = 'USD';
  const googleHasData = googleR.status === 'fulfilled' && googleMap.size > 0;
  if (googleR.status === 'fulfilled') {
    googleCurrency = googleR.value.currency;
    errors.push(...googleR.value.errors);
  } else { errors.push(`Google: ${String(googleR.reason)}`); }

  // ── Currency auto-detection ───────────────────────────────────
  // Business truth = Shopify store currency (what revenue is booked in).
  // Fallback order: Shopify → Meta → Google → USD.

  let shopifyCurrency = 'USD';
  if (shopHasData) {
    // Shopify orders are in the store's currency — take the highest-revenue country's currency.
    let maxRev = -1;
    shopMap.forEach((v) => { if (v.rev > maxRev) { maxRev = v.rev; shopifyCurrency = v.cur || 'USD'; } });
  }

  const baseCurrency = baseCurrencyOverride && baseCurrencyOverride !== 'AUTO'
    ? baseCurrencyOverride
    : (shopHasData ? shopifyCurrency : (metaCurrency !== 'USD' ? metaCurrency : (googleCurrency !== 'USD' ? googleCurrency : 'USD')));

  const fxRates = await getFxRates();
  const toB = (v: number, native: string): number => toBase(v, native, baseCurrency, fxRates);

  // ── Aggregate Meta: country → campaign ──

  interface CA { cid: string; name: string; spend: number; impr: number; clicks: number; purch: number; pv: number; }
  const ccMap = new Map<string, Map<string, CA>>();
  let emptyCountryCount = 0;

  for (const row of metaRows) {
    const rawCountry = (row.country || '').toString().trim();
    const country = rawCountry || 'XX';
    if (!rawCountry) emptyCountryCount++;

    const cid = row.campaign_id;
    const spend = parseFloat(row.spend || '0');
    const clicks = parseInt(row.clicks || '0');

    if (!ccMap.has(country)) ccMap.set(country, new Map());
    const cm = ccMap.get(country)!;

    if (cm.has(cid)) {
      const ex = cm.get(cid)!;
      ex.spend += spend;
      ex.impr += parseInt(row.impressions || '0');
      ex.clicks += clicks;
      ex.purch += extractMetaAction(row.actions, 'purchase');
      ex.pv += extractMetaAction(row.action_values, 'purchase');
    } else {
      cm.set(cid, { cid, name: row.campaign_name || cid, spend, impr: parseInt(row.impressions || '0'), clicks, purch: extractMetaAction(row.actions, 'purchase'), pv: extractMetaAction(row.action_values, 'purchase') });
    }
  }

  if (emptyCountryCount > 0) {
    warnings.push(`${emptyCountryCount} Meta rows had no country code. Grouped under 'XX'. This means Meta couldn't geo-attribute those impressions — likely from Advantage+ or worldwide targeting.`);
  }

  // ── Build CountryRow[] ──

  const allCountries = new Set<string>();
  ccMap.forEach((_, c) => allCountries.add(c));
  shopMap.forEach((_, c) => allCountries.add(c));
  googleMap.forEach((_, c) => allCountries.add(c));

  const countryRows: CountryRow[] = [];

  allCountries.forEach((cc) => {
    const cm = ccMap.get(cc) || new Map();
    const shop = shopMap.get(cc);
    const gSpend = googleMap.get(cc) || 0;

    let mSpend = 0, mPurch = 0, mPv = 0;
    const campaigns: CampaignRow[] = [];

    cm.forEach((agg) => {
      mSpend += agg.spend; mPurch += agg.purch; mPv += agg.pv;
      const roas = agg.spend > 0 ? agg.pv / agg.spend : 0;

      campaigns.push({
        campaign_id: agg.cid, campaign_name: agg.name,
        campaign_type: classObj(cInfo[agg.cid]?.obj || 'UNKNOWN'),
        status: cInfo[agg.cid]?.status || 'UNKNOWN',
        spend: Math.round(agg.spend * 100) / 100,
        impressions: agg.impr, clicks: agg.clicks,
        ctr: agg.impr > 0 ? Math.round((agg.clicks / agg.impr) * 10000) / 100 : 0,
        purchases: agg.purch,
        purchase_value: Math.round(agg.pv * 100) / 100,
        roas: Math.round(roas * 100) / 100,
        aov: agg.purch > 0 ? Math.round(toB(agg.pv / agg.purch, metaCurrency) * 100) / 100 : 0,
        cpa: agg.purch > 0 ? Math.round(toB(agg.spend / agg.purch, metaCurrency) * 100) / 100 : 0,
        meta_currency: metaCurrency,
        normalized_spend: Math.round(toB(agg.spend, metaCurrency) * 100) / 100,
        normalized_revenue: Math.round(toB(agg.pv, metaCurrency) * 100) / 100,
        normalized_roas: Math.round(roas * 100) / 100,
        spend_rank: 0,
        raw_country: cc,
      });
    });

    campaigns.sort((a, b) => b.spend - a.spend);

    const shopCur = shop?.cur || metaCurrency;
    const sRev = shop?.rev || 0;
    const sNCRev = shop?.ncRev || 0;

    const mRoas = mSpend > 0 ? mPv / mSpend : 0;
    const nMetaSpend = toB(mSpend, metaCurrency);
    const nGoogleSpend = toB(gSpend, googleCurrency);
    const nTotalSpend = nMetaSpend + nGoogleSpend;
    const nRev = toB(sRev, shopCur);
    const nNCRev = toB(sNCRev, shopCur);

    // aMER = NC revenue ÷ TOTAL ad spend (Meta + Google), not just Meta.
    const amer: number | null = shopHasData && nTotalSpend > 0 ? nNCRev / nTotalSpend : (shopHasData ? 0 : null);

    countryRows.push({
      country: cc, country_name: countryName(cc), flag: countryFlag(cc),
      meta_spend: Math.round(mSpend * 100) / 100,
      meta_purchases: mPurch,
      meta_purchase_value: Math.round(mPv * 100) / 100,
      meta_roas: Math.round(mRoas * 100) / 100,
      meta_currency: metaCurrency,
      google_spend: Math.round(gSpend * 100) / 100,
      google_currency: googleCurrency,
      shopify_revenue: Math.round(sRev * 100) / 100,
      shopify_nc_revenue: Math.round(sNCRev * 100) / 100,
      shopify_currency: shop?.cur || shopifyCurrency,
      shopify_orders: shop?.ord || 0,
      shopify_nc_orders: shop?.ncOrd || 0,
      shopify_connected: shopHasData,
      normalized_spend: Math.round(nMetaSpend * 100) / 100,
      normalized_google_spend: Math.round(nGoogleSpend * 100) / 100,
      normalized_total_spend: Math.round(nTotalSpend * 100) / 100,
      normalized_revenue: Math.round(nRev * 100) / 100,
      normalized_nc_revenue: Math.round(nNCRev * 100) / 100,
      normalized_roas: Math.round(mRoas * 100) / 100,
      nc_aov: shopHasData && (shop?.ncOrd || 0) > 0 ? Math.round(toB(sNCRev / shop!.ncOrd, shopCur) * 100) / 100 : null,
      ncac: shopHasData && (shop?.ncOrd || 0) > 0 ? Math.round(toB(nTotalSpend / shop!.ncOrd, baseCurrency) * 100) / 100 : null,
      amer: amer !== null ? Math.round(amer * 100) / 100 : null,
      inc_roas: Math.round(mRoas * IF_FACTOR * 100) / 100,
      roas_vs_amer_gap: amer !== null ? Math.round((mRoas - amer) * 100) / 100 : null,
      spend_rank: 0, amer_rank: 0, spend_efficiency: 'healthy',
      campaigns, campaign_count: campaigns.length, spend_share: 0, cta: null,
    });
  });

  // Sort by total spend descending
  countryRows.sort((a, b) => b.normalized_total_spend - a.normalized_total_spend);
  const amerSorted = [...countryRows].sort((a, b) => (b.amer ?? -Infinity) - (a.amer ?? -Infinity));
  const amerRankMap = new Map<string, number>();
  amerSorted.forEach((r, i) => amerRankMap.set(r.country, i + 1));

  for (let i = 0; i < countryRows.length; i++) {
    const r = countryRows[i];
    r.spend_rank = i + 1;
    r.amer_rank = amerRankMap.get(r.country) || (i + 1);
    const e = classify(r.spend_rank, r.amer_rank, r.amer);
    r.spend_efficiency = e.eff; r.cta = e.cta;

    const sortedCamps = [...r.campaigns].sort((a, b) => b.spend - a.spend);
    for (const camp of r.campaigns) {
      camp.spend_rank = sortedCamps.findIndex(c => c.campaign_id === camp.campaign_id) + 1;
    }
  }

  const totalNS = countryRows.reduce((s, r) => s + r.normalized_total_spend, 0);
  for (const r of countryRows) r.spend_share = totalNS > 0 ? Math.round((r.normalized_total_spend / totalNS) * 10000) / 100 : 0;

  // Totals
  const tMetaSpendN = countryRows.reduce((s, r) => s + r.normalized_spend, 0);
  const tGoogleSpendN = countryRows.reduce((s, r) => s + r.normalized_google_spend, 0);
  const tTotalSpendN = tMetaSpendN + tGoogleSpendN;
  const tRev = countryRows.reduce((s, r) => s + r.normalized_revenue, 0);
  const tNCRev = countryRows.reduce((s, r) => s + r.normalized_nc_revenue, 0);
  const tOrd = countryRows.reduce((s, r) => s + r.shopify_orders, 0);
  const tNCOrd = countryRows.reduce((s, r) => s + r.shopify_nc_orders, 0);
  const tPurch = countryRows.reduce((s, r) => s + r.meta_purchases, 0);
  const tCamp = countryRows.reduce((s, r) => s + r.campaign_count, 0);
  const totalMetaPv = countryRows.reduce((s, r) => s + r.meta_purchase_value, 0);
  const totalMetaSpendRaw = countryRows.reduce((s, r) => s + r.meta_spend, 0);
  const tMetaRoas = totalMetaSpendRaw > 0 ? totalMetaPv / totalMetaSpendRaw : 0;
  const tAmer: number | null = shopHasData && tTotalSpendN > 0 ? tNCRev / tTotalSpendN : null;

  const response: GeoResponse = {
    countries: countryRows,
    totals: {
      normalized_meta_spend: Math.round(tMetaSpendN * 100) / 100,
      normalized_google_spend: Math.round(tGoogleSpendN * 100) / 100,
      normalized_spend: Math.round(tTotalSpendN * 100) / 100,
      normalized_revenue: Math.round(tRev * 100) / 100,
      normalized_nc_revenue: Math.round(tNCRev * 100) / 100,
      meta_roas: Math.round(tMetaRoas * 100) / 100,
      normalized_roas: Math.round(tMetaRoas * 100) / 100,
      amer: tAmer !== null ? Math.round(tAmer * 100) / 100 : null,
      inc_roas: Math.round(tMetaRoas * IF_FACTOR * 100) / 100,
      total_orders: tOrd, total_nc_orders: tNCOrd, total_purchases: tPurch,
      base_currency: baseCurrency, country_count: countryRows.length,
      campaign_count: tCamp, brand_gross_margin_pct: grossMarginPct,
      if_factor: IF_FACTOR, shopify_connected: shopHasData,
      google_connected: googleHasData,
    },
    baseCurrency,
    shopify_currency: shopifyCurrency,
    meta_currency: metaCurrency,
    google_currency: googleCurrency,
    fxRates,
    date_range: { from: since, to: until },
    errors: errors.length > 0 ? errors : undefined,
    warnings: warnings.length > 0 ? warnings : undefined,
  };

  return NextResponse.json(response);
}