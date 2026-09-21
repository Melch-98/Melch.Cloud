import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { gaqlQuery, normalizeCustomerId } from '@/lib/pipeboard-google';
import { getFxRates, toBase } from '@/lib/currency';

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
  shop_timezone: string;
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

/** Calendar date in an IANA zone, YYYY-MM-DD (en-CA). */
function ymdInTimeZone(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function addCalendarDays(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10);
}

function dateRangeForZone(range: string, timeZone: string): { since: string; until: string } {
  // "Last N days" = N full shop-local days ending yesterday.
  // Daily P&L dates orders with Shopify's shop-local calendar date, so the
  // window has to be computed in that zone (not UTC) or the boundary day drifts.
  const today = ymdInTimeZone(new Date(), timeZone);
  const yesterday = addCalendarDays(today, -1);
  const daysFor = (n: number) => addCalendarDays(yesterday, -(n - 1));
  switch (range) {
    case 'last_7d': return { since: daysFor(7), until: yesterday };
    case 'last_14d': return { since: daysFor(14), until: yesterday };
    case 'last_30d': return { since: daysFor(30), until: yesterday };
    case 'last_90d': return { since: daysFor(90), until: yesterday };
    case 'this_month': return { since: `${today.slice(0, 8)}01`, until: today };
    default: return { since: daysFor(30), until: yesterday };
  }
}

function orderStoreDate(shopifyCreatedAt: string, timeZone: string): string {
  const parsed = new Date(shopifyCreatedAt);
  if (Number.isNaN(parsed.getTime())) return '';
  return ymdInTimeZone(parsed, timeZone);
}

function asId(value: number | string | null | undefined): number | null {
  if (value == null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isSafeInteger(n) ? n : null;
}

function grossSales(subtotal: string | number | null, discounts: string | number | null): number {
  // Same basis as shopify-sync → daily_pnl: subtotal (after discounts) + discounts.
  return (Number(subtotal) || 0) + (Number(discounts) || 0);
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

// FX: shared via @/lib/currency (open.er-api.com USD pivot)

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

// ─── Shopify auth (same grant as shopify-sync) ─────────────────

async function getShopifyToken(domain: string, clientId: string, clientSecret: string): Promise<string> {
  const res = await fetch(`https://${domain}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  if (!res.ok) {
    throw new Error(`Shopify token exchange failed (${res.status})`);
  }
  const data = await res.json();
  if (!data?.access_token) throw new Error('Shopify token exchange returned no access token');
  return data.access_token as string;
}

async function resolveShopifyAuth(
  supabase: any,
  brand: { shopify_store_domain?: string | null; shopify_client_id?: string | null; shopify_client_secret?: string | null },
): Promise<{ domain: string; token: string } | null> {
  const domain = brand.shopify_store_domain;
  if (!domain) return null;

  const { data: storeRow } = await supabase
    .from('shopify_stores')
    .select('access_token, uninstalled_at')
    .eq('shop_domain', domain)
    .maybeSingle();

  if (storeRow?.access_token && storeRow.access_token !== 'gadget-managed' && !storeRow.uninstalled_at) {
    return { domain, token: storeRow.access_token };
  }
  if (!brand.shopify_client_id || !brand.shopify_client_secret) return null;
  const token = await getShopifyToken(domain, brand.shopify_client_id, brand.shopify_client_secret);
  return { domain, token };
}

async function fetchShopTimeZone(domain: string, token: string): Promise<string | null> {
  const res = await fetch(`https://${domain}/admin/api/2024-01/shop.json?fields=iana_timezone`, {
    headers: { 'X-Shopify-Access-Token': token },
  });
  if (!res.ok) return null;
  const body = await res.json();
  const tz = body?.shop?.iana_timezone as string | undefined;
  if (!tz) return null;
  try {
    ymdInTimeZone(new Date(), tz);
    return tz;
  } catch {
    return null;
  }
}

// Shopify Customer.numberOfOrders — the same lifetime count shopify-sync uses
// for daily_pnl NC/RC. Embedded customer.orders_count is not on these payloads.
async function fetchLifetimeOrderCounts(
  domain: string,
  token: string,
  customerIds: number[],
): Promise<Map<number, number>> {
  const counts = new Map<number, number>();
  const CHUNK = 100;
  for (let i = 0; i < customerIds.length; i += CHUNK) {
    const slice = customerIds.slice(i, i + CHUNK);
    const res = await fetch(`https://${domain}/admin/api/2024-01/graphql.json`, {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: `query($ids: [ID!]!) {
          nodes(ids: $ids) {
            ... on Customer { id numberOfOrders }
          }
        }`,
        variables: { ids: slice.map((id) => `gid://shopify/Customer/${id}`) },
      }),
    });
    if (!res.ok) throw new Error(`Shopify customer lookup failed (${res.status})`);
    const body = await res.json();
    if (body?.errors?.length) {
      throw new Error(body.errors[0]?.message || 'Shopify customer lookup failed');
    }
    for (const node of body?.data?.nodes || []) {
      if (!node?.id) continue;
      const id = asId(String(node.id).split('/').pop());
      const raw = node.numberOfOrders;
      const num = typeof raw === 'string' ? parseInt(raw, 10) : raw;
      if (id != null && typeof num === 'number' && num > 0) counts.set(id, num);
    }
    if (i + CHUNK < customerIds.length) await new Promise((r) => setTimeout(r, 40));
  }
  return counts;
}

interface ShopCountryBucket {
  rev: number;
  ncRev: number;
  cur: string;
  ord: number;
  ncOrd: number;
}

interface OrderHist {
  firstAt: number;
  firstId: number;
  count: number;
}

// ─── Fetch Shopify by country with NC/RC ───────────────────────
//
// A new-customer order is that customer's first non-voided order ever.
// shopify_orders does not hold full store history (Mintier order names are
// ~#27000 while the table starts 2026-06-28), so "earliest row we stored"
// marks returning customers as new. Match daily_pnl instead:
//   NC iff this is the earliest stored non-voided order
//      AND stored non-voided count >= Shopify Customer.numberOfOrders
// When lifetime > stored, orders before the sync window exist and every
// stored order is returning.

async function fetchShopifyByCountry(
  supabase: any,
  brandId: string,
  since: string,
  until: string,
  timeZone: string,
  shopify: { domain: string; token: string } | null,
): Promise<{ byCountry: Map<string, ShopCountryBucket>; hasData: boolean; warnings: string[] }> {
  const warnings: string[] = [];
  const PAGE = 1000;
  const utcSince = `${addCalendarDays(since, -2)}T00:00:00Z`;
  const utcUntil = `${addCalendarDays(until, 2)}T23:59:59.999Z`;

  interface WindowOrder {
    shopify_order_id: number;
    customer_id: number | null;
    shipping_address: any;
    billing_address: any;
    subtotal_price: string | number | null;
    total_discounts: string | number | null;
    currency: string | null;
    financial_status: string | null;
    shopify_created_at: string;
  }

  const windowOrders: WindowOrder[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('shopify_orders')
      .select('shopify_order_id, customer_id, shipping_address, billing_address, subtotal_price, total_discounts, currency, financial_status, shopify_created_at')
      .eq('brand_id', brandId)
      .gte('shopify_created_at', utcSince)
      .lte('shopify_created_at', utcUntil)
      .order('shopify_order_id', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    for (const row of data as WindowOrder[]) {
      const storeDate = orderStoreDate(row.shopify_created_at, timeZone);
      if (storeDate >= since && storeDate <= until) windowOrders.push(row);
    }
    if (data.length < PAGE) break;
  }

  const kept = windowOrders.filter((o) => o.financial_status !== 'voided');
  if (kept.length === 0) return { byCountry: new Map(), hasData: false, warnings };

  const customerIds: number[] = [];
  const seen = new Set<number>();
  for (const o of kept) {
    const id = asId(o.customer_id);
    if (id != null && !seen.has(id)) {
      seen.add(id);
      customerIds.push(id);
    }
  }

  const hist = new Map<number, OrderHist>();
  const consider = (customerId: number, orderId: number, createdAt: string, financialStatus: string | null) => {
    if (financialStatus === 'voided') return;
    const at = new Date(createdAt).getTime();
    if (!Number.isFinite(at)) return;
    const prev = hist.get(customerId);
    if (!prev) {
      hist.set(customerId, { firstAt: at, firstId: orderId, count: 1 });
      return;
    }
    prev.count += 1;
    if (at < prev.firstAt || (at === prev.firstAt && orderId < prev.firstId)) {
      prev.firstAt = at;
      prev.firstId = orderId;
    }
  };

  for (let i = 0; i < customerIds.length; i += 50) {
    const chunk = customerIds.slice(i, i + 50);
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from('shopify_orders')
        .select('customer_id, shopify_order_id, shopify_created_at, financial_status')
        .eq('brand_id', brandId)
        .in('customer_id', chunk)
        .order('shopify_order_id', { ascending: true })
        .order('id', { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw new Error(error.message);
      if (!data || data.length === 0) break;
      for (const row of data) {
        const cid = asId(row.customer_id);
        const oid = asId(row.shopify_order_id);
        if (cid == null || oid == null) continue;
        consider(cid, oid, row.shopify_created_at as string, row.financial_status as string | null);
      }
      if (data.length < PAGE) break;
    }
  }

  let lifetime = new Map<number, number>();
  let lifetimeLookupOk = false;
  if (shopify && customerIds.length > 0) {
    try {
      lifetime = await fetchLifetimeOrderCounts(shopify.domain, shopify.token, customerIds);
      lifetimeLookupOk = true;
    } catch (e: any) {
      warnings.push(`Shopify lifetime order counts unavailable (${e?.message || 'lookup failed'}). New-customer orders are omitted rather than guessed from partial history.`);
    }
  } else if (!customerIds.length) {
    lifetimeLookupOk = true;
  }

  let unverifiedCustomers = 0;
  const byCountry = new Map<string, ShopCountryBucket>();

  for (const o of kept) {
    const cc = normShopifyCountry(o.shipping_address) || normShopifyCountry(o.billing_address);
    if (!cc) continue;
    const rev = grossSales(o.subtotal_price, o.total_discounts);
    const cur = o.currency || 'USD';
    const cid = asId(o.customer_id);
    const oid = asId(o.shopify_order_id);
    let isNC = false;

    if (cid == null) {
      isNC = true; // guest checkout — same as daily P&L
    } else if (oid != null) {
      const h = hist.get(cid);
      const life = lifetime.get(cid);
      const isFirst = !!h && h.firstId === oid;
      if (lifetimeLookupOk && isFirst && life == null) unverifiedCustomers += 1;
      // Returning orders (not the stored first) stay RC even if lifetime is missing.
      isNC = isFirst && life != null && h!.count >= life;
    }

    const ex = byCountry.get(cc);
    if (ex) {
      ex.rev += rev;
      ex.ord += 1;
      if (isNC) { ex.ncRev += rev; ex.ncOrd += 1; }
    } else {
      byCountry.set(cc, { rev, ncRev: isNC ? rev : 0, cur, ord: 1, ncOrd: isNC ? 1 : 0 });
    }
  }

  if (unverifiedCustomers > 0) {
    warnings.push(`${unverifiedCustomers} customers had no Shopify lifetime order count. Their orders are included in totals but not counted as new customers.`);
  }

  return { byCountry, hasData: true, warnings };
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
    .select('id, name, meta_ad_account_id, shopify_store_domain, gross_margin_pct, google_ads_customer_id, shopify_client_id, shopify_client_secret')
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

  const errors: string[] = [];
  const warnings: string[] = [];
  const grossMarginPct = brand.gross_margin_pct || 60;

  let shopifyAuth: { domain: string; token: string } | null = null;
  let shopifyAuthError: string | null = null;
  try {
    shopifyAuth = await resolveShopifyAuth(supabase, brand);
  } catch (e: any) {
    shopifyAuthError = e?.message || 'token exchange';
  }
  if (!shopifyAuth) {
    warnings.push(
      shopifyAuthError
        ? `Shopify auth failed (${shopifyAuthError}). New-customer orders are omitted rather than guessed from partial history.`
        : 'Shopify is not connected, so new-customer orders cannot be separated from returning orders. Totals exclude the new-customer split.',
    );
  }

  let shopTimeZone = 'UTC';
  if (shopifyAuth) {
    try {
      const tz = await fetchShopTimeZone(shopifyAuth.domain, shopifyAuth.token);
      if (tz) shopTimeZone = tz;
      else warnings.push('Shopify shop timezone was unavailable. The date window uses UTC.');
    } catch {
      warnings.push('Shopify shop timezone was unavailable. The date window uses UTC.');
    }
  }

  const { since, until } = dateRangeForZone(dateRange, shopTimeZone);

  // ── Fetch all three sources in parallel ──

  const [metaR, shopR, googleR] = await Promise.allSettled([
    metaToken && brand.meta_ad_account_id
      ? fetchMetaGeo(metaToken, brand.meta_ad_account_id, since, until)
      : Promise.resolve({ rows: [], currency: 'USD', cInfo: {} as Record<string, { obj: string; status: string }>, errors: ['No Meta config'] }),
    fetchShopifyByCountry(supabase, brandId, since, until, shopTimeZone, shopifyAuth),
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

  const shopMap = shopR.status === 'fulfilled' ? shopR.value.byCountry : new Map<string, ShopCountryBucket>();
  const shopHasData = shopR.status === 'fulfilled' ? shopR.value.hasData : false;
  if (shopR.status === 'fulfilled') warnings.push(...shopR.value.warnings);
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
    shop_timezone: shopTimeZone,
    errors: errors.length > 0 ? errors : undefined,
    warnings: warnings.length > 0 ? warnings : undefined,
  };

  return NextResponse.json(response);
}