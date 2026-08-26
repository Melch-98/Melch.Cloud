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
  meta_currency: string;
  normalized_spend: number;
  normalized_revenue: number;
  normalized_roas: number;
  // KB metrics
  amer: number;
  inc_roas: number;
  spend_rank: number;
  amer_rank: number;
  spend_efficiency: 'over' | 'healthy' | 'under';
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
  meta_roas: number;
  // Shopify totals (in store currency)
  shopify_revenue: number;
  shopify_nc_revenue: number;
  shopify_currency: string;
  shopify_orders: number;
  shopify_nc_orders: number;
  // Normalized
  normalized_spend: number;
  normalized_revenue: number;
  normalized_nc_revenue: number;
  normalized_roas: number;
  // KB metrics
  amer: number;
  inc_roas: number;
  roas_vs_amer_gap: number;
  spend_rank: number;
  amer_rank: number;
  spend_efficiency: 'over' | 'healthy' | 'under';
  // Campaigns
  campaigns: CampaignRow[];
  campaign_count: number;
  spend_share: number;
  // Rendering
  cta: string | null;
}

interface GeoResponse {
  countries: CountryRow[];
  totals: {
    normalized_spend: number;
    normalized_revenue: number;
    normalized_nc_revenue: number;
    normalized_roas: number;
    amer: number;
    inc_roas: number;
    total_orders: number;
    total_nc_orders: number;
    total_purchases: number;
    base_currency: string;
    country_count: number;
    campaign_count: number;
    brand_gross_margin_pct: number;
    if_factor: number;
  };
  base_currency: string;
  fx_rates: Record<string, number>;
  date_range: { from: string; to: string };
  errors?: string[];
}

// ─── KB Constants ───────────────────────────────────────────────

// From the DTC KB: CTC benchmark for Meta 7dc incrementality factor
// Post-March 2026: 1.38x (was 1.2x pre-March 2026)
const DEFAULT_IF_FACTOR = 1.38;

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

function classifyObjective(objective: string): string {
  // Map Meta objectives to KB framework: demand capture vs demand creation
  const upper = (objective || '').toUpperCase();
  if (upper.includes('OUTCOME_SALES') || upper.includes('OUTCOME_CONVERSIONS') || upper.includes('CONVERSIONS')) return 'Demand Capture';
  if (upper.includes('OUTCOME_TRAFFIC') || upper.includes('OUTCOME_ENGAGEMENT') || upper.includes('OUTCOME_LEAD')) return 'Demand Capture';
  if (upper.includes('OUTCOME_AWARENESS') || upper.includes('OUTCOME_REACH') || upper.includes('OUTCOME_VIDEO_VIEWS')) return 'Demand Creation';
  if (upper.includes('OUTCOME_APP_PROMOTION')) return 'Demand Capture';
  if (upper.includes('UNKNOWN')) return 'Unknown';
  return 'Demand Capture';
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

  const campaignIdsSet = new Set<string>();
  allRows.forEach((r: any) => campaignIdsSet.add(r.campaign_id));
  const campaignIds = Array.from(campaignIdsSet);
  const campaignInfo: Record<string, MetaCampaignInfo> = {};

  if (campaignIds.length > 0) {
    try {
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

// ─── Fetch Shopify orders by country with NC/RC split ────────────

async function fetchShopifyOrdersByCountry(
  supabase: any,
  brandId: string,
  dateSince: string,
  dateUntil: string
): Promise<{
  byCountry: Map<string, {
    revenue: number;
    ncRevenue: number;
    currency: string;
    orders: number;
    ncOrders: number;
  }>;
  hasData: boolean;
}> {
  const PAGE_SIZE = 1000;

  // Strategy: pull ALL orders in window (not just those with shipping_address)
  // then detect NC vs RC by customer's first order date across ALL history
  // Then, separately aggregate by shipping_address country

  interface OrderRow {
    shopify_order_id: number;
    customer_id: number | null;
    shipping_address: any;
    total_price: string;
    currency: string;
    shopify_created_at: string;
  }

  // Step 1: Pull all orders in range (with shipping_address for geo, customer_id for NC/RC)
  const allOrders: OrderRow[] = [];
  let page = 0;
  while (true) {
    const { data, error } = await supabase
      .from('shopify_orders')
      .select('shopify_order_id, customer_id, shipping_address, total_price, currency, shopify_created_at')
      .eq('brand_id', brandId)
      .gte('shopify_created_at', `${dateSince}T00:00:00Z`)
      .lte('shopify_created_at', `${dateUntil}T23:59:59Z`)
      .order('shopify_created_at', { ascending: true })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

    if (error) break;
    if (!data || data.length === 0) break;
    allOrders.push(...(data as OrderRow[]));
    if (data.length < PAGE_SIZE) break;
    page++;
  }

  if (allOrders.length === 0) {
    return { byCountry: new Map(), hasData: false };
  }

  // Step 2: Detect NC vs RC — for each customer, find their first order date globally
  const custSet = new Set<number>();
  allOrders.filter((o: OrderRow) => o.customer_id).forEach((o: OrderRow) => custSet.add(o.customer_id as number));
  const customerIds = Array.from(custSet);

  const customerFirstOrder = new Map<number, string>();

  if (customerIds.length > 0) {
    // Batch query: get each customer's first order date across ALL history
    // Use a single query with IN filter, grouped by customer_id
    for (let i = 0; i < customerIds.length; i += 100) {
      const chunk = customerIds.slice(i, i + 100);
      const { data: custOrders } = await supabase
        .from('shopify_orders')
        .select('customer_id, shopify_created_at')
        .eq('brand_id', brandId)
        .in('customer_id', chunk)
        .order('shopify_created_at', { ascending: true });

      if (custOrders) {
        for (const co of custOrders) {
          const cid = co.customer_id as number;
          const ts = co.shopify_created_at as string;
          const existing = customerFirstOrder.get(cid);
          if (!existing || ts < existing) {
            customerFirstOrder.set(cid, ts);
          }
        }
      }
    }
  }

  // Step 3: Classify each order
  // NC = first order for this customer OR guest (no customer_id)

  // Step 4: Aggregate by country
  const byCountry = new Map<string, {
    revenue: number;
    ncRevenue: number;
    currency: string;
    orders: number;
    ncOrders: number;
  }>();

  for (const order of allOrders) {
    const cc = normalizeShopifyCountry(order.shipping_address);
    if (!cc) continue;

    const rev = parseFloat(order.total_price || '0');
    const cur = order.currency || 'USD';

    let isNC = false;
    if (!order.customer_id) {
      // Guest orders are NC
      isNC = true;
    } else {
      const firstTs = customerFirstOrder.get(order.customer_id);
      if (firstTs) {
        // If this order's timestamp is within 1 hour of the first order = it IS the first order
        const orderTs = new Date(order.shopify_created_at).getTime();
        const firstOrderTs = new Date(firstTs).getTime();
        isNC = Math.abs(orderTs - firstOrderTs) < 1000;
      } else {
        // No first order found — treat as NC (safest)
        isNC = true;
      }
    }

    const existing = byCountry.get(cc);
    if (existing) {
      existing.revenue += rev;
      if (isNC) {
        existing.ncRevenue += rev;
        existing.ncOrders += 1;
      }
      existing.orders += 1;
    } else {
      byCountry.set(cc, {
        revenue: rev,
        ncRevenue: isNC ? rev : 0,
        currency: cur,
        orders: 1,
        ncOrders: isNC ? 1 : 0,
      });
    }
  }

  return { byCountry, hasData: true };
}

// ─── Compute KB Metrics ─────────────────────────────────────────

function computeSpendEfficiency(
  spendRank: number,
  amerRank: number,
  amer: number,
  roas: number
): { efficiency: 'over' | 'healthy' | 'under'; cta: string | null } {
  // If spend rank is much higher than aMER rank (e.g., #1 spend but #5 aMER),
  // this country is overspending — diminishing returns have set in.
  // If aMER rank >> spend rank, there's headroom to scale.

  const diff = spendRank - amerRank;

  if (diff >= 2 && amer < 1.0) {
    return { efficiency: 'over', cta: 'Reduce or pause — diminishing returns' };
  }
  if (diff >= 2) {
    return { efficiency: 'over', cta: 'Cut lowest-ROAS campaigns' };
  }
  if (diff <= -2 && amer >= 1.5) {
    return { efficiency: 'under', cta: 'Scale — room to increase spend' };
  }
  if (amer >= 2.0) {
    return { efficiency: 'under', cta: 'Strong: test higher spend' };
  }
  return { efficiency: 'healthy', cta: null };
}

// ─── Main Handler ───────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

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

  const { data: brand, error: brandError } = await supabase
    .from('brands')
    .select('id, name, meta_ad_account_id, shopify_store_domain, gross_margin_pct')
    .eq('id', brandId)
    .single();

  if (brandError || !brand) {
    return NextResponse.json({ error: 'Brand not found' }, { status: 404 });
  }

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
  const grossMarginPct = brand.gross_margin_pct || 60;

  // ── Fetch in parallel ──

  let metaRows: any[] = [];
  let metaCurrency = 'USD';
  let campaignInfo: Record<string, MetaCampaignInfo> = {};

  const [metaResult, shopifyResult] = await Promise.allSettled([
    metaToken && brand.meta_ad_account_id
      ? fetchMetaGeoData(metaToken, brand.meta_ad_account_id, since, until)
      : Promise.resolve({ rows: [], currency: 'USD', campaignInfo: {} as Record<string, MetaCampaignInfo>, errors: ['No Meta config'] }),
    fetchShopifyOrdersByCountry(supabase, brandId, since, until),
  ]);

  if (metaResult.status === 'fulfilled') {
    metaRows = metaResult.value.rows;
    metaCurrency = metaResult.value.currency;
    campaignInfo = metaResult.value.campaignInfo;
    errors.push(...metaResult.value.errors);
  } else {
    errors.push(`Meta: ${String(metaResult.reason)}`);
  }

  const shopifyData = shopifyResult.status === 'fulfilled'
    ? shopifyResult.value.byCountry
    : new Map();

  if (shopifyResult.status === 'rejected') {
    errors.push(`Shopify: ${String(shopifyResult.reason)}`);
  }

  // ── FX Rates ──

  const fxRates = await getFxRates(baseCurrency);
  const getRate = (cur: string): number => fxRates[cur] || 1;

  // ── Aggregate Meta by country × campaign ──

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

  for (const row of metaRows) {
    const country = row.country || 'XX';
    const cid = row.campaign_id;
    const spend = parseFloat(row.spend || '0');
    const impressions = parseInt(row.impressions || '0');
    const clicks = parseInt(row.clicks || '0');
    const purchases = extractMetaAction(row.actions, 'purchase');
    const purchaseValue = extractMetaAction(row.action_values, 'purchase');

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

  // ── Build CountryRow[] ──

  const allCountries = new Set<string>();
  countryCampMap.forEach((_, cc) => allCountries.add(cc));
  shopifyData.forEach((_, cc) => allCountries.add(cc));

  const countryRows: CountryRow[] = [];
  const metaRate = getRate(metaCurrency);

  allCountries.forEach((cc) => {
    const campMap = countryCampMap.get(cc) || new Map();
    const shop = shopifyData.get(cc);

    let metaSpend = 0;
    let metaPurchases = 0;
    let metaPurchaseValue = 0;
    const campaigns: CampaignRow[] = [];

    campMap.forEach((agg) => {
      metaSpend += agg.spend;
      metaPurchases += agg.purchases;
      metaPurchaseValue += agg.purchase_value;

      const nSpend = agg.spend * metaRate;
      const nRevenue = agg.purchase_value * metaRate;
      const roas = agg.spend > 0 ? agg.purchase_value / agg.spend : 0;

      campaigns.push({
        campaign_id: agg.campaign_id,
        campaign_name: agg.campaign_name,
        campaign_type: classifyObjective(campaignInfo[agg.campaign_id]?.objective || 'UNKNOWN'),
        status: campaignInfo[agg.campaign_id]?.status || 'UNKNOWN',
        spend: Math.round(agg.spend * 100) / 100,
        impressions: agg.impressions,
        clicks: agg.clicks,
        ctr: agg.impressions > 0 ? Math.round((agg.clicks / agg.impressions) * 10000) / 100 : 0,
        purchases: agg.purchases,
        purchase_value: Math.round(agg.purchase_value * 100) / 100,
        roas: Math.round(roas * 100) / 100,
        meta_currency: metaCurrency,
        normalized_spend: Math.round(nSpend * 100) / 100,
        normalized_revenue: Math.round(nRevenue * 100) / 100,
        normalized_roas: Math.round(roas * 100) / 100,
        // KB metrics — placeholder, computed after sorting
        amer: 0,
        inc_roas: 0,
        spend_rank: 0,
        amer_rank: 0,
        spend_efficiency: 'healthy',
      });
    });

    campaigns.sort((a, b) => b.spend - a.spend);

    const shopCur = shop?.currency || metaCurrency;
    const shopRate = getRate(shopCur);

    const nSpend = metaSpend * metaRate;
    const shopRev = shop?.revenue || 0;
    const shopNCRev = shop?.ncRevenue || 0;
    const nRevenue = shopRev * shopRate;
    const nNCRevenue = shopNCRev * shopRate;
    const metaRoas = metaSpend > 0 ? metaPurchaseValue / metaSpend : 0;

    // aMER = NC Shopify revenue ÷ Meta spend (the CTC north star)
    const amer = nSpend > 0 ? nNCRevenue / nSpend : 0;
    // Incremental ROAS = nROAS × IF (calibrating platform to business truth)
    const nRoas = nSpend > 0 ? nRevenue / nSpend : 0;

    countryRows.push({
      country: cc,
      country_name: countryName(cc),
      flag: countryFlag(cc),
      meta_spend: Math.round(metaSpend * 100) / 100,
      meta_currency: metaCurrency,
      meta_purchases: metaPurchases,
      meta_purchase_value: Math.round(metaPurchaseValue * 100) / 100,
      meta_roas: Math.round(metaRoas * 100) / 100,
      shopify_revenue: Math.round(shopRev * 100) / 100,
      shopify_nc_revenue: Math.round(shopNCRev * 100) / 100,
      shopify_currency: shop?.currency || metaCurrency,
      shopify_orders: shop?.orders || 0,
      shopify_nc_orders: shop?.ncOrders || 0,
      normalized_spend: Math.round(nSpend * 100) / 100,
      normalized_revenue: Math.round(nRevenue * 100) / 100,
      normalized_nc_revenue: Math.round(nNCRevenue * 100) / 100,
      normalized_roas: Math.round(nRoas * 100) / 100,
      amer: Math.round(amer * 100) / 100,
      inc_roas: 0, // computed after sort (uses IF)
      roas_vs_amer_gap: Math.round((nRoas - amer) * 100) / 100,
      spend_rank: 0,
      amer_rank: 0,
      spend_efficiency: 'healthy',
      campaigns,
      campaign_count: campaigns.length,
      spend_share: 0,
      cta: null,
    });
  });

  // Sort by normalized spend descending
  countryRows.sort((a, b) => b.normalized_spend - a.normalized_spend);

  // Assign ranks and compute KB metrics
  // Sort a COPY by aMER to get aMER ranks
  const amerSorted = [...countryRows].sort((a, b) => b.amer - a.amer);
  const amerRankMap = new Map<string, number>();
  amerSorted.forEach((r, i) => amerRankMap.set(r.country, i + 1));

  for (let i = 0; i < countryRows.length; i++) {
    const r = countryRows[i];
    r.spend_rank = i + 1;
    r.amer_rank = amerRankMap.get(r.country) || (i + 1);

    const eff = computeSpendEfficiency(r.spend_rank, r.amer_rank, r.amer, r.normalized_roas);
    r.spend_efficiency = eff.efficiency;
    r.cta = eff.cta;

    // Incremental ROAS = nROAS × IF (calibrating to business truth)
    // From KB: IF = 1.38x post-March 2026 for Meta 7dc
    r.inc_roas = Math.round(r.normalized_roas * DEFAULT_IF_FACTOR * 100) / 100;

    // Compute campaign-level KB metrics
    for (const camp of r.campaigns) {
      const campNCSpend = r.normalized_spend > 0
        ? (camp.normalized_spend / r.normalized_spend) * r.normalized_nc_revenue
        : 0;
      camp.amer = camp.normalized_spend > 0
        ? Math.round((campNCSpend / camp.normalized_spend) * 100) / 100
        : 0;
      camp.inc_roas = Math.round(camp.normalized_roas * DEFAULT_IF_FACTOR * 100) / 100;

      // Sort campaigns by spend for ranking
      const campSpendRanked = [...r.campaigns].sort((a, b) => b.spend - a.spend);
      camp.spend_rank = campSpendRanked.findIndex((c) => c.campaign_id === camp.campaign_id) + 1;

      const campAmerRanked = [...r.campaigns].sort((a, b) => b.amer - a.amer);
      camp.amer_rank = campAmerRanked.findIndex((c) => c.campaign_id === camp.campaign_id) + 1;

      const campDiff = camp.spend_rank - camp.amer_rank;
      if (campDiff >= 2 && camp.amer < 0.5) {
        camp.spend_efficiency = 'over';
      } else if (campDiff >= 2) {
        camp.spend_efficiency = 'over';
      } else if (campDiff <= -2 && camp.amer >= 1.5) {
        camp.spend_efficiency = 'under';
      } else {
        camp.spend_efficiency = 'healthy';
      }
    }
  }

  // Compute spend share
  const totalNS = countryRows.reduce((s, r) => s + r.normalized_spend, 0);
  for (const r of countryRows) {
    r.spend_share = totalNS > 0 ? Math.round((r.normalized_spend / totalNS) * 10000) / 100 : 0;
  }

  // Totals
  const totalNRev = countryRows.reduce((s, r) => s + r.normalized_revenue, 0);
  const totalNCRev = countryRows.reduce((s, r) => s + r.normalized_nc_revenue, 0);
  const totalOrders = countryRows.reduce((s, r) => s + r.shopify_orders, 0);
  const totalNCOrders = countryRows.reduce((s, r) => s + r.shopify_nc_orders, 0);
  const totalPurchases = countryRows.reduce((s, r) => s + r.meta_purchases, 0);
  const totalCampaigns = countryRows.reduce((s, r) => s + r.campaign_count, 0);
  const totalAmer = totalNS > 0 ? totalNCRev / totalNS : 0;
  const totalROAS = totalNS > 0 ? totalNRev / totalNS : 0;

  const response: GeoResponse = {
    countries: countryRows,
    totals: {
      normalized_spend: Math.round(totalNS * 100) / 100,
      normalized_revenue: Math.round(totalNRev * 100) / 100,
      normalized_nc_revenue: Math.round(totalNCRev * 100) / 100,
      normalized_roas: Math.round(totalROAS * 100) / 100,
      amer: Math.round(totalAmer * 100) / 100,
      inc_roas: Math.round(totalROAS * DEFAULT_IF_FACTOR * 100) / 100,
      total_orders: totalOrders,
      total_nc_orders: totalNCOrders,
      total_purchases: totalPurchases,
      base_currency: baseCurrency,
      country_count: countryRows.length,
      campaign_count: totalCampaigns,
      brand_gross_margin_pct: grossMarginPct,
      if_factor: DEFAULT_IF_FACTOR,
    },
    base_currency: baseCurrency,
    fx_rates: fxRates,
    date_range: { from: since, to: until },
    errors: errors.length > 0 ? errors : undefined,
  };

  return NextResponse.json(response);
}