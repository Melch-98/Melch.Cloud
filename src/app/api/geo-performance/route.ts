import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// ─── Types ──────────────────────────────────────────────────────

interface CampaignRow {
  campaign_id: string;
  campaign_name: string;
  campaign_type: string;
  status: string;
  // Meta data only — no Shopify/aMER at campaign level
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  purchases: number;
  purchase_value: number;
  roas: number;
  aov: number;                  // purchase_value / purchases
  cpa: number;                  // spend / purchases
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
  meta_spend: number;
  meta_purchases: number;
  meta_purchase_value: number;
  meta_roas: number;
  meta_currency: string;
  shopify_revenue: number;
  shopify_nc_revenue: number;
  shopify_currency: string;
  shopify_orders: number;
  shopify_nc_orders: number;
  shopify_connected: boolean;
  nc_aov: number | null;        // NC revenue ÷ NC orders
  ncac: number | null;           // Spend ÷ NC orders
  normalized_spend: number;
  normalized_revenue: number;
  normalized_nc_revenue: number;
  normalized_roas: number;
  amer: number | null;
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
    normalized_spend: number;
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
  };
  baseCurrency: string;
  fxRates: Record<string, number>;
  meta_currency: string;
  date_range: { from: string; to: string };
  errors?: string[];
  warnings?: string[];
}

// ─── Constants ──────────────────────────────────────────────────
const IF_FACTOR = 1.38;

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
  switch (range) {
    case 'last_7d': { const d = new Date(now); d.setDate(d.getDate() - 7); return { since: fmtDate(d), until: fmtDate(now) }; }
    case 'last_14d': { const d = new Date(now); d.setDate(d.getDate() - 14); return { since: fmtDate(d), until: fmtDate(now) }; }
    case 'last_30d': { const d = new Date(now); d.setDate(d.getDate() - 30); return { since: fmtDate(d), until: fmtDate(now) }; }
    case 'last_90d': { const d = new Date(now); d.setDate(d.getDate() - 90); return { since: fmtDate(d), until: fmtDate(now) }; }
    case 'this_month': return { since: fmtDate(new Date(now.getFullYear(), now.getMonth(), 1)), until: fmtDate(now) };
    default: return { since: fmtDate(new Date(now.getTime() - 30 * 86400000)), until: fmtDate(now) };
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

// ─── FX ─────────────────────────────────────────────────────────

const FX_CACHE: { rates: Record<string, number>; ts: number } = { rates: {}, ts: 0 };
async function getFxRates(base: string): Promise<Record<string, number>> {
  if (Date.now() - FX_CACHE.ts < 3600000 && Object.keys(FX_CACHE.rates).length > 0) return FX_CACHE.rates;
  try {
    const res = await fetch(`https://open.er-api.com/v6/latest/${base}`);
    if (res.ok) { const d: any = await res.json(); FX_CACHE.rates = d.rates || {}; FX_CACHE.ts = Date.now(); return FX_CACHE.rates; }
  } catch {}
  if (base === 'USD') return { USD: 1, CAD: 0.72, GBP: 1.27, EUR: 1.09, AUD: 0.65, NZD: 0.59 };
  return { [base]: 1 };
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

  // Campaign metadata
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
  const baseCurrency = (searchParams.get('baseCurrency') || 'USD').toUpperCase();
  if (!brandId) return NextResponse.json({ error: 'brandId required' }, { status: 400 });
  if (profile.role !== 'admin' && profile.brand_id !== brandId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { data: brand, error: brandErr } = await supabase
    .from('brands').select('id, name, meta_ad_account_id, shopify_store_domain, gross_margin_pct').eq('id', brandId).single();
  if (brandErr || !brand) return NextResponse.json({ error: 'Brand not found' }, { status: 404 });

  let metaToken = process.env.META_ACCESS_TOKEN || '';
  if (!metaToken) {
    const { data: s } = await supabase.from('app_settings').select('value').eq('key', 'meta_access_token').single();
    metaToken = s?.value || '';
  }

  const { since, until } = dateRangeToMeta(dateRange);
  const errors: string[] = [];
  const warnings: string[] = [];
  const grossMarginPct = brand.gross_margin_pct || 60;

  // ── Fetch ──

  const [metaR, shopR] = await Promise.allSettled([
    metaToken && brand.meta_ad_account_id
      ? fetchMetaGeo(metaToken, brand.meta_ad_account_id, since, until)
      : Promise.resolve({ rows: [], currency: 'USD', cInfo: {} as Record<string, { obj: string; status: string }>, errors: ['No Meta config'] }),
    fetchShopifyByCountry(supabase, brandId, since, until),
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

  const fxRates = await getFxRates(baseCurrency);
  const getRate = (cur: string): number => fxRates[cur] || 1;

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
    warnings.push(`${emptyCountryCount} Meta rows had no country code. Grouped under 'XX'. This means Meta couldn't geo-attribute those impressions — likely from Advantage+ or worldwide targeting where delivery location is ambiguous.`);
  }

  // ── Build CountryRow[] ──

  const allCountries = new Set<string>();
  ccMap.forEach((_, c) => allCountries.add(c));
  shopMap.forEach((_, c) => allCountries.add(c));

  const countryRows: CountryRow[] = [];
  const metaRate = getRate(metaCurrency);

  allCountries.forEach((cc) => {
    const cm = ccMap.get(cc) || new Map();
    const shop = shopMap.get(cc);

    let mSpend = 0, mPurch = 0, mPv = 0;
    const campaigns: CampaignRow[] = [];

    cm.forEach((agg) => {
      mSpend += agg.spend; mPurch += agg.purch; mPv += agg.pv;
      const nSp = agg.spend * metaRate;
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
        aov: agg.purch > 0 ? Math.round((agg.pv / agg.purch) * 100) / 100 : 0,
        cpa: agg.purch > 0 ? Math.round((agg.spend / agg.purch) * 100) / 100 : 0,
        meta_currency: metaCurrency,
        normalized_spend: Math.round(nSp * 100) / 100,
        normalized_revenue: Math.round(agg.pv * metaRate * 100) / 100,
        normalized_roas: Math.round(roas * 100) / 100,
        spend_rank: 0,
        raw_country: cc,
      });
    });

    campaigns.sort((a, b) => b.spend - a.spend);

    const shopCur = shop?.cur || metaCurrency;
    const shopRate = getRate(shopCur);
    const sRev = shop?.rev || 0;
    const sNCRev = shop?.ncRev || 0;

    const mRoas = mSpend > 0 ? mPv / mSpend : 0;
    const nSpend = mSpend * metaRate;
    const nRev = sRev * shopRate;
    const nNCRev = sNCRev * shopRate;
    const amer: number | null = shopHasData && nSpend > 0 ? nNCRev / nSpend : (shopHasData ? 0 : null);

    countryRows.push({
      country: cc, country_name: countryName(cc), flag: countryFlag(cc),
      meta_spend: Math.round(mSpend * 100) / 100,
      meta_purchases: mPurch,
      meta_purchase_value: Math.round(mPv * 100) / 100,
      meta_roas: Math.round(mRoas * 100) / 100,
      meta_currency: metaCurrency,
      shopify_revenue: Math.round(sRev * 100) / 100,
      shopify_nc_revenue: Math.round(sNCRev * 100) / 100,
      shopify_currency: shop?.cur || metaCurrency,
      shopify_orders: shop?.ord || 0,
      shopify_nc_orders: shop?.ncOrd || 0,
      shopify_connected: shopHasData,
      nc_aov: shopHasData && (shop?.ncOrd || 0) > 0 ? Math.round((sNCRev / shop!.ncOrd) * 100) / 100 : null,
      ncac: shopHasData && (shop?.ncOrd || 0) > 0 ? Math.round((mSpend / shop!.ncOrd) * 100) / 100 : null,
      normalized_spend: Math.round(nSpend * 100) / 100,
      normalized_revenue: Math.round(nRev * 100) / 100,
      normalized_nc_revenue: Math.round(nNCRev * 100) / 100,
      normalized_roas: Math.round(mRoas * 100) / 100,
      amer: amer !== null ? Math.round(amer * 100) / 100 : null,
      inc_roas: Math.round(mRoas * IF_FACTOR * 100) / 100,
      roas_vs_amer_gap: amer !== null ? Math.round((mRoas - amer) * 100) / 100 : null,
      spend_rank: 0, amer_rank: 0, spend_efficiency: 'healthy',
      campaigns, campaign_count: campaigns.length, spend_share: 0, cta: null,
    });
  });

  // Sort, rank, classify
  countryRows.sort((a, b) => b.normalized_spend - a.normalized_spend);
  const amerSorted = [...countryRows].sort((a, b) => (b.amer ?? -Infinity) - (a.amer ?? -Infinity));
  const amerRankMap = new Map<string, number>();
  amerSorted.forEach((r, i) => amerRankMap.set(r.country, i + 1));

  for (let i = 0; i < countryRows.length; i++) {
    const r = countryRows[i];
    r.spend_rank = i + 1;
    r.amer_rank = amerRankMap.get(r.country) || (i + 1);
    const e = classify(r.spend_rank, r.amer_rank, r.amer);
    r.spend_efficiency = e.eff; r.cta = e.cta;

    // Assign campaign spend ranks within country
    const sortedCamps = [...r.campaigns].sort((a, b) => b.spend - a.spend);
    for (const camp of r.campaigns) {
      camp.spend_rank = sortedCamps.findIndex(c => c.campaign_id === camp.campaign_id) + 1;
    }
  }

  const totalNS = countryRows.reduce((s, r) => s + r.normalized_spend, 0);
  for (const r of countryRows) r.spend_share = totalNS > 0 ? Math.round((r.normalized_spend / totalNS) * 10000) / 100 : 0;

  // Totals
  const tRev = countryRows.reduce((s, r) => s + r.normalized_revenue, 0);
  const tNCRev = countryRows.reduce((s, r) => s + r.normalized_nc_revenue, 0);
  const tOrd = countryRows.reduce((s, r) => s + r.shopify_orders, 0);
  const tNCOrd = countryRows.reduce((s, r) => s + r.shopify_nc_orders, 0);
  const tPurch = countryRows.reduce((s, r) => s + r.meta_purchases, 0);
  const tCamp = countryRows.reduce((s, r) => s + r.campaign_count, 0);
  const totalMetaPv = countryRows.reduce((s, r) => s + r.meta_purchase_value, 0);
  const totalMetaSpend = countryRows.reduce((s, r) => s + r.meta_spend, 0);
  const tMetaRoas = totalMetaSpend > 0 ? totalMetaPv / totalMetaSpend : 0;
  const tAmer: number | null = shopHasData && totalNS > 0 ? tNCRev / totalNS : null;

  const response: GeoResponse = {
    countries: countryRows,
    totals: {
      normalized_spend: Math.round(totalNS * 100) / 100,
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
    },
    baseCurrency,
    fxRates,
    meta_currency: metaCurrency,
    date_range: { from: since, to: until },
    errors: errors.length > 0 ? errors : undefined,
    warnings: warnings.length > 0 ? warnings : undefined,
  };

  return NextResponse.json(response);
}