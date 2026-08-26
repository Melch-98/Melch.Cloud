import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// ─── Types ──────────────────────────────────────────────────────

interface MetaCampaignInfo {
  objective: string;
  status: string;
}

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
  // Local currency
  meta_currency: string;
  // Normalized
  normalized_spend: number;
  normalized_revenue: number;
  normalized_roas: number;
}

interface CountryRow {
  country: string;
  country_name: string;
  flag: string;
  // Meta totals (in account currency)
  meta_spend: number;
  meta_currency: string;
  meta_purchases: number;
  meta_purchase_value: number;
  // Shopify totals (in store currency)
  shopify_revenue: number;
  shopify_currency: string;
  shopify_orders: number;
  // Normalized
  normalized_spend: number;
  normalized_revenue: number;
  normalized_roas: number;
  // Campaigns running in this country
  campaigns: CampaignRow[];
  campaign_count: number;
  // Derived
  spend_share: number; // % of total normalized spend
}

interface GeoResponse {
  countries: CountryRow[];
  totals: {
    normalized_spend: number;
    normalized_revenue: number;
    normalized_roas: number;
    total_orders: number;
    total_purchases: number;
    base_currency: string;
    country_count: number;
    campaign_count: number;
  };
  base_currency: string;
  fx_rates: Record<string, number>;
  date_range: { from: string; to: string };
  errors?: string[];
}

// ─── Helpers ────────────────────────────────────────────────────

function extractMetaAction(actions: any[] | undefined, actionType: string): number {
  if (!actions) return 0;
  const found = actions.find((a: any) => a.action_type === actionType);
  return found ? parseFloat(found.value) : 0;
}

function fmtDate(d: Date): string {
  return d.toISOString().split('T')[0];
}

function dateRangeToMeta(range: string): { since: string; until: string } {
  const now = new Date();
  switch (range) {
    case 'last_7d': {
      const d = new Date(now); d.setDate(d.getDate() - 7);
      return { since: fmtDate(d), until: fmtDate(now) };
    }
    case 'last_14d': {
      const d = new Date(now); d.setDate(d.getDate() - 14);
      return { since: fmtDate(d), until: fmtDate(now) };
    }
    case 'last_30d': {
      const d = new Date(now); d.setDate(d.getDate() - 30);
      return { since: fmtDate(d), until: fmtDate(now) };
    }
    case 'last_90d': {
      const d = new Date(now); d.setDate(d.getDate() - 90);
      return { since: fmtDate(d), until: fmtDate(now) };
    }
    case 'this_month':
      return { since: fmtDate(new Date(now.getFullYear(), now.getMonth(), 1)), until: fmtDate(now) };
    case 'last_month': {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const end = new Date(now.getFullYear(), now.getMonth(), 0);
      return { since: fmtDate(start), until: fmtDate(end) };
    }
    default:
      return { since: fmtDate(new Date(now.getTime() - 30 * 86400000)), until: fmtDate(now) };
  }
}

// ─── Country helpers ────────────────────────────────────────────

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

function countryName(code: string): string {
  const upper = code?.toUpperCase() || '';
  return COUNTRY_NAMES[upper] || upper;
}
function countryFlag(code: string): string {
  return COUNTRY_FLAGS[code?.toUpperCase()] || '🌐';
}

function normalizeShopifyCountry(addr: any): string {
  if (!addr) return '';
  let cc = (addr.country_code || addr.country || '').toUpperCase();
  const nameMap: Record<string, string> = {
    'UNITED STATES': 'US', 'CANADA': 'CA', 'UNITED KINGDOM': 'GB',
    'AUSTRALIA': 'AU', 'NEW ZEALAND': 'NZ', 'GERMANY': 'DE',
    'FRANCE': 'FR', 'ITALY': 'IT', 'SPAIN': 'ES', 'NETHERLANDS': 'NL',
    'SWITZERLAND': 'CH', 'SWEDEN': 'SE', 'NORWAY': 'NO', 'DENMARK': 'DK',
    'FINLAND': 'FI', 'IRELAND': 'IE', 'PORTUGAL': 'PT', 'JAPAN': 'JP',
    'SOUTH KOREA': 'KR', 'MEXICO': 'MX', 'BRAZIL': 'BR', 'SINGAPORE': 'SG',
    'HONG KONG': 'HK', 'UNITED ARAB EMIRATES': 'AE',
  };
  return nameMap[cc] || cc;
}

// ─── FX Rates ───────────────────────────────────────────────────

const FX_CACHE: { rates: Record<string, number>; timestamp: number } = { rates: {}, timestamp: 0 };
const FX_CACHE_TTL_MS = 60 * 60 * 1000;

async function getFxRates(base: string): Promise<Record<string, number>> {
  if (Date.now() - FX_CACHE.timestamp < FX_CACHE_TTL_MS && Object.keys(FX_CACHE.rates).length > 0) {
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
  } catch { /* fallback */ }
  // Hardcoded fallback vs USD
  if (base === 'USD') return { USD: 1, CAD: 0.72, GBP: 1.27, EUR: 1.09, AUD: 0.65, NZD: 0.59 };
  return { [base]: 1 };
}

// ─── Fetch Meta campaign×country data ───────────────────────────

async function fetchMetaGeoData(
  accessToken: string,
  adAccountId: string,
  dateSince: string,
  dateUntil: string
): Promise<{
  rows: any[];
  currency: string;
  campaignInfo: Record<string, MetaCampaignInfo>;
  errors: string[];
}> {
  const errors: string[] = [];
  const accountId = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`;

  // Get account currency
  let currency = 'USD';
  try {
    const cRes = await fetch(
      `https://graph.facebook.com/v21.0/${accountId}?fields=currency&access_token=${accessToken}`
    );
    if (cRes.ok) {
      const cData: any = await cRes.json();
      if (cData?.currency) currency = cData.currency;
    }
  } catch { /* keep USD */ }

  // Fetch insights: campaign level, broken down by country
  const timeRange = encodeURIComponent(JSON.stringify({ since: dateSince, until: dateUntil }));
  const fields = 'campaign_id,campaign_name,spend,impressions,clicks,reach,actions,action_values';
  const url =
    `https://graph.facebook.com/v21.0/${accountId}/insights?` +
    `level=campaign&breakdowns=country` +
    `&time_range=${timeRange}` +
    `&action_attribution_windows=["7d_click","1d_view"]` +
    `&fields=${fields}&limit=500` +
    `&access_token=${accessToken}`;

  const allRows: any[] = [];

  try {
    const firstRes = await fetch(url);
    const firstData = await firstRes.json();
    if (firstData.error) {
      errors.push(`Meta API: ${firstData.error.message || firstData.error} (code ${firstData.error.code || '?'})`);
      return { rows: [], currency, campaignInfo: {}, errors };
    }
    // Meta returns data in reverse-chronological order — this is fine, we'll aggregate

    // Paginate
    let nextUrl: string | null = url;
    while (nextUrl) {
      const res = await fetch(String(nextUrl));
      if (!res.ok) break;
      const page: any = await res.json();
      if (page.error) {
        errors.push(`Meta pagination error: ${page.error.message}`);
        break;
      }
      if (page.data) allRows.push(...page.data);
      nextUrl = page.paging?.next || null;
    }
  } catch (e: any) {
    errors.push(`Meta fetch failed: ${e.message}`);
    return { rows: allRows, currency, campaignInfo: {}, errors };
  }

  // Collect unique campaign IDs and fetch metadata
  const campaignIdsSet = new Set<string>();
  allRows.forEach((r: any) => campaignIdsSet.add(r.campaign_id));
  const campaignIds = Array.from(campaignIdsSet);
  const campaignInfo: Record<string, MetaCampaignInfo> = {};

  if (campaignIds.length > 0) {
    try {
      // Fetch in chunks of 50 to avoid URL too long
      for (let i = 0; i < campaignIds.length; i += 50) {
        const chunk = campaignIds.slice(i, i + 50);
        const idsParam = chunk.join(',');
        const metaInfoRes = await fetch(
          `https://graph.facebook.com/v21.0/?ids=${idsParam}&fields=objective,effective_status&access_token=${accessToken}`
        );
        if (metaInfoRes.ok) {
          const metaInfo: any = await metaInfoRes.json();
          for (const [cid, info] of Object.entries(metaInfo as Record<string, any>)) {
            campaignInfo[cid] = {
              objective: (info as any).objective || 'UNKNOWN',
              status: (info as any).effective_status || 'UNKNOWN',
            };
          }
        }
      }
    } catch { /* non-fatal */ }
  }

  return { rows: allRows, currency, campaignInfo, errors };
}

// ─── Fetch Shopify Country Revenue ──────────────────────────────

async function fetchShopifyCountryRevenue(
  supabase: any,
  brandId: string,
  dateSince: string,
  dateUntil: string
): Promise<{ country: string; revenue: number; currency: string; orders: number }[]> {
  const PAGE_SIZE = 1000;
  const countryMap = new Map<string, { revenue: number; currency: string; orders: number }>();

  let page = 0;
  while (true) {
    const { data, error } = await supabase
      .from('shopify_orders')
      .select('total_price, currency, shipping_address, shopify_created_at')
      .eq('brand_id', brandId)
      .gte('shopify_created_at', `${dateSince}T00:00:00Z`)
      .lte('shopify_created_at', `${dateUntil}T23:59:59Z`)
      .order('shopify_created_at', { ascending: false })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

    if (error) break;
    if (!data || data.length === 0) break;

    for (const order of data) {
      const cc = normalizeShopifyCountry(order.shipping_address);
      if (!cc) continue;
      const rev = parseFloat(order.total_price || '0');
      const cur = order.currency || 'USD';
      const existing = countryMap.get(cc);
      if (existing) {
        existing.revenue += rev;
        existing.orders += 1;
      } else {
        countryMap.set(cc, { revenue: rev, currency: cur, orders: 1 });
      }
    }

    if (data.length < PAGE_SIZE) break;
    page++;
  }

  return Array.from(countryMap.entries()).map(([country, d]) => ({
    country,
    revenue: d.revenue,
    currency: d.currency,
    orders: d.orders,
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
  if (!authHeader) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

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
  const dateRange = searchParams.get('dateRange') || 'last_30d';
  const baseCurrency = (searchParams.get('baseCurrency') || 'USD').toUpperCase();

  if (!brandId) {
    return NextResponse.json({ error: 'brandId required' }, { status: 400 });
  }

  if (profile.role !== 'admin' && profile.brand_id !== brandId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Get brand
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

  const { since, until } = dateRangeToMeta(dateRange);
  const errors: string[] = [];

  // ── Fetch in parallel ──

  let metaRows: any[] = [];
  let metaCurrency = 'USD';
  let campaignInfo: Record<string, MetaCampaignInfo> = {};
  let shopifyData: {
    country: string;
    revenue: number;
    currency: string;
    orders: number;
  }[] = [];

  const [metaResult, shopifyResult] = await Promise.allSettled([
    metaToken && brand.meta_ad_account_id
      ? fetchMetaGeoData(metaToken, brand.meta_ad_account_id, since, until)
      : Promise.resolve({ rows: [], currency: 'USD', campaignInfo: {} as Record<string, MetaCampaignInfo>, errors: ['No Meta config'] }),
    fetchShopifyCountryRevenue(supabase, brandId, since, until),
  ]);

  if (metaResult.status === 'fulfilled') {
    metaRows = metaResult.value.rows;
    metaCurrency = metaResult.value.currency;
    campaignInfo = metaResult.value.campaignInfo;
    errors.push(...metaResult.value.errors);
  } else {
    errors.push(`Meta: ${String(metaResult.reason)}`);
  }

  if (shopifyResult.status === 'fulfilled') {
    shopifyData = shopifyResult.value;
  } else {
    errors.push(`Shopify: ${String(shopifyResult.reason)}`);
  }

  // ── FX Rates ──

  const fxRates = await getFxRates(baseCurrency);
  const getRate = (cur: string): number => fxRates[cur] || 1;

  // ── Aggregate Meta by country × campaign ──
  // Structure: Map<country, Map<campaignId, { spend, impressions, clicks, purchases, purchaseValue }>>

  interface CampAgg {
    campaign_id: string;
    campaign_name: string;
    spend: number;
    impressions: number;
    clicks: number;
    purchases: number;
    purchase_value: number;
  }

  const countryCampMap = new Map<string, Map<string, CampAgg>>();
  let totalMetaSpendRaw = 0;

  for (const row of metaRows) {
    const country = row.country || 'XX';
    const cid = row.campaign_id;
    const spend = parseFloat(row.spend || '0');
    const impressions = parseInt(row.impressions || '0');
    const clicks = parseInt(row.clicks || '0');
    const purchases = extractMetaAction(row.actions, 'purchase');
    const purchaseValue = extractMetaAction(row.action_values, 'purchase');

    totalMetaSpendRaw += spend;

    if (!countryCampMap.has(country)) {
      countryCampMap.set(country, new Map());
    }
    const campMap = countryCampMap.get(country)!;

    if (campMap.has(cid)) {
      const existing = campMap.get(cid)!;
      existing.spend += spend;
      existing.impressions += impressions;
      existing.clicks += clicks;
      existing.purchases += purchases;
      existing.purchase_value += purchaseValue;
    } else {
      campMap.set(cid, {
        campaign_id: cid,
        campaign_name: row.campaign_name || cid,
        spend,
        impressions,
        clicks,
        purchases,
        purchase_value: purchaseValue,
      });
    }
  }

  // ── Build Shopify lookup ──

  const shopifyMap = new Map<string, { revenue: number; currency: string; orders: number }>();
  for (const s of shopifyData) {
    shopifyMap.set(s.country, { revenue: s.revenue, currency: s.currency, orders: s.orders });
  }

  // ── Merge into CountryRow[] ──

  const allCountries = new Set<string>();
  countryCampMap.forEach((_, cc) => allCountries.add(cc));
  shopifyMap.forEach((_, cc) => allCountries.add(cc));

  const countryRows: CountryRow[] = [];

  allCountries.forEach((cc) => {
    const campMap = countryCampMap.get(cc) || new Map();
    const shop = shopifyMap.get(cc);

    // Country-level Meta totals
    let metaSpend = 0;
    let metaPurchases = 0;
    let metaPurchaseValue = 0;
    const campaigns: CampaignRow[] = [];

    campMap.forEach((agg) => {
      metaSpend += agg.spend;
      metaPurchases += agg.purchases;
      metaPurchaseValue += agg.purchase_value;

      const metaRate = getRate(metaCurrency);
      const nSpend = agg.spend * metaRate;

      // For campaign ROAS, we calculate against the camp's own spend
      // (no per-campaign Shopify breakdown available)
      campaigns.push({
        campaign_id: agg.campaign_id,
        campaign_name: agg.campaign_name,
        campaign_type: campaignInfo[agg.campaign_id]?.objective || 'UNKNOWN',
        status: campaignInfo[agg.campaign_id]?.status || 'UNKNOWN',
        spend: Math.round(agg.spend * 100) / 100,
        impressions: agg.impressions,
        clicks: agg.clicks,
        ctr: agg.impressions > 0 ? Math.round((agg.clicks / agg.impressions) * 10000) / 100 : 0,
        purchases: agg.purchases,
        purchase_value: Math.round(agg.purchase_value * 100) / 100,
        roas: agg.spend > 0 ? Math.round((agg.purchase_value / agg.spend) * 100) / 100 : 0,
        meta_currency: metaCurrency,
        normalized_spend: Math.round(nSpend * 100) / 100,
        normalized_revenue: Math.round(agg.purchase_value * metaRate * 100) / 100,
        normalized_roas: agg.spend > 0 ? Math.round((agg.purchase_value / agg.spend) * 100) / 100 : 0,
      });
    });

    // Sort campaigns by spend descending
    campaigns.sort((a, b) => b.spend - a.spend);

    const metaRate = getRate(metaCurrency);
    const shopCur = shop?.currency || metaCurrency;
    const shopRate = getRate(shopCur);

    const nSpend = metaSpend * metaRate;
    const shopRev = shop?.revenue || 0;
    const nRevenue = shopRev * shopRate;
    const nROAS = nSpend > 0 ? Math.round((nRevenue / nSpend) * 100) / 100 : 0;

    countryRows.push({
      country: cc,
      country_name: countryName(cc),
      flag: countryFlag(cc),
      meta_spend: Math.round(metaSpend * 100) / 100,
      meta_currency: metaCurrency,
      meta_purchases: metaPurchases,
      meta_purchase_value: Math.round(metaPurchaseValue * 100) / 100,
      shopify_revenue: Math.round(shopRev * 100) / 100,
      shopify_currency: shop?.currency || metaCurrency,
      shopify_orders: shop?.orders || 0,
      normalized_spend: Math.round(nSpend * 100) / 100,
      normalized_revenue: Math.round(nRevenue * 100) / 100,
      normalized_roas: nROAS,
      campaigns,
      campaign_count: campaigns.length,
      spend_share: 0, // computed after sort
    });
  });

  // Sort by normalized spend descending
  countryRows.sort((a, b) => b.normalized_spend - a.normalized_spend);

  // Compute spend share
  const totalNormalizedSpend = countryRows.reduce((s, r) => s + r.normalized_spend, 0);
  for (const r of countryRows) {
    r.spend_share = totalNormalizedSpend > 0
      ? Math.round((r.normalized_spend / totalNormalizedSpend) * 10000) / 100
      : 0;
  }

  // Totals
  const totalRev = countryRows.reduce((s, r) => s + r.normalized_revenue, 0);
  const totalOrders = countryRows.reduce((s, r) => s + r.shopify_orders, 0);
  const totalPurchases = countryRows.reduce((s, r) => s + r.meta_purchases, 0);
  const totalCampaigns = countryRows.reduce((s, r) => s + r.campaign_count, 0);

  const response: GeoResponse = {
    countries: countryRows,
    totals: {
      normalized_spend: Math.round(totalNormalizedSpend * 100) / 100,
      normalized_revenue: Math.round(totalRev * 100) / 100,
      normalized_roas: totalNormalizedSpend > 0
        ? Math.round((totalRev / totalNormalizedSpend) * 100) / 100
        : 0,
      total_orders: totalOrders,
      total_purchases: totalPurchases,
      base_currency: baseCurrency,
      country_count: countryRows.length,
      campaign_count: totalCampaigns,
    },
    base_currency: baseCurrency,
    fx_rates: fxRates,
    date_range: { from: since, to: until },
    errors: errors.length > 0 ? errors : undefined,
  };

  return NextResponse.json(response);
}