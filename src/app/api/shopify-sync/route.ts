import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  getSyncRateLimiter,
  acquireSyncLock,
  releaseSyncLock,
  getCachedPnl,
  setCachedPnl,
  invalidatePnlCache,
} from '@/lib/redis';

export const dynamic = 'force-dynamic';
export const maxDuration = 120; // Shopify pagination can take a while

// ─── Types ──────────────────────────────────────────────────────

interface ShopifyOrder {
  id: number;
  created_at: string;
  financial_status: string;
  total_price: string;
  subtotal_price: string;
  total_discounts: string;
  total_tax: string;
  total_shipping_price_set: {
    shop_money: { amount: string };
  };
  refunds: ShopifyRefund[];
  customer: {
    id: number;
    orders_count: number;
  } | null;
  line_items: {
    price: string;
    quantity: number;
  }[];
}

interface ShopifyRefund {
  id: number;
  created_at: string;
  refund_line_items: {
    subtotal: number;
    total_tax: number;
  }[];
  transactions: {
    amount: string;
    kind: string;
  }[];
}

interface DayBucket {
  nc_orders: number;
  nc_revenue: number;
  rc_orders: number;
  rc_revenue: number;
  gross_sales: number;
  discounts: number;
  refunds: number;
  taxes: number;
  shipping: number;
}

// ─── Shopify Token Exchange (Client Credentials Grant) ──────────

async function getShopifyToken(
  domain: string,
  clientId: string,
  clientSecret: string
): Promise<string> {
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
    const body = await res.text();
    throw new Error(`Shopify token exchange failed (${res.status}): ${body}`);
  }

  const data = await res.json();
  return data.access_token;
}

// ─── Shopify API helper ─────────────────────────────────────────

async function shopifyFetch(
  domain: string,
  token: string,
  endpoint: string,
  params: Record<string, string> = {}
): Promise<{ data: unknown; nextLink: string | null }> {
  const url = new URL(`https://${domain}/admin/api/2024-01/${endpoint}.json`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url.toString(), {
    headers: {
      'X-Shopify-Access-Token': token,
      'Content-Type': 'application/json',
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Shopify API ${res.status}: ${body}`);
  }

  // Parse Link header for pagination
  const linkHeader = res.headers.get('Link') || '';
  let nextLink: string | null = null;
  const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
  if (nextMatch) nextLink = nextMatch[1];

  const data = await res.json();
  return { data, nextLink };
}

async function fetchAllOrders(
  domain: string,
  token: string,
  sinceDate: string,
  untilDate: string
): Promise<ShopifyOrder[]> {
  const allOrders: ShopifyOrder[] = [];
  let nextUrl: string | null = null;

  // First request
  const params: Record<string, string> = {
    status: 'any',
    created_at_min: sinceDate,
    created_at_max: untilDate,
    limit: '250',
    fields: 'id,created_at,financial_status,total_price,subtotal_price,total_discounts,total_tax,total_shipping_price_set,refunds,customer,line_items',
  };

  const first = await shopifyFetch(domain, token, 'orders', params);
  const firstData = first.data as { orders: ShopifyOrder[] };
  allOrders.push(...firstData.orders);
  nextUrl = first.nextLink;

  // Paginate
  while (nextUrl) {
    const res = await fetch(nextUrl, {
      headers: {
        'X-Shopify-Access-Token': token,
        'Content-Type': 'application/json',
      },
    });

    if (!res.ok) break;

    const linkHeader = res.headers.get('Link') || '';
    const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
    nextUrl = nextMatch ? nextMatch[1] : null;

    const data = (await res.json()) as { orders: ShopifyOrder[] };
    allOrders.push(...data.orders);

    // Shopify rate limit: 2 req/sec — short pause is enough
    await new Promise((r) => setTimeout(r, 100));
  }

  return allOrders;
}

// ─── Aggregation ────────────────────────────────────────────────

function aggregateOrdersByDay(orders: ShopifyOrder[]): Map<string, DayBucket> {
  const buckets = new Map<string, DayBucket>();

  const getOrCreate = (dateStr: string): DayBucket => {
    if (!buckets.has(dateStr)) {
      buckets.set(dateStr, {
        nc_orders: 0,
        nc_revenue: 0,
        rc_orders: 0,
        rc_revenue: 0,
        gross_sales: 0,
        discounts: 0,
        refunds: 0,
        taxes: 0,
        shipping: 0,
      });
    }
    return buckets.get(dateStr)!;
  };

  // ── NC/RC classification ──
  // An order is "new customer" iff it is that customer's FIRST order ever.
  // Previous logic marked the earliest order *within the sync window* as NC,
  // which mis-classified returning customers whose prior orders fell outside
  // the window. We now compare window-order-count vs customer.orders_count
  // (Shopify's lifetime count snapshot). If lifetime > window count, the
  // customer already had prior orders → ALL their window orders are RC.
  const customerOrders = new Map<number, ShopifyOrder[]>();
  const guestOrders: ShopifyOrder[] = [];

  for (const order of orders) {
    if (order.financial_status === 'voided') continue;
    if (!order.customer) {
      guestOrders.push(order); // No customer → treat as NC
    } else {
      const custId = order.customer.id;
      if (!customerOrders.has(custId)) customerOrders.set(custId, []);
      customerOrders.get(custId)!.push(order);
    }
  }

  // Build set of first-order IDs per customer (only when their first order
  // actually falls inside this sync window).
  const firstOrderIds = new Set<number>();
  for (const [, custOrds] of customerOrders) {
    custOrds.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    const lifetimeCount = (custOrds[0].customer as { orders_count?: number } | undefined)?.orders_count ?? 0;
    // If lifetime count equals what we see in the window, the earliest one
    // we saw IS their first ever order → mark as NC.
    if (lifetimeCount > 0 && lifetimeCount <= custOrds.length) {
      firstOrderIds.add(custOrds[0].id);
    }
    // Otherwise lifetimeCount > window count → all are returning, none flagged.
  }

  // Process all non-voided orders
  const allOrders = [...guestOrders];
  for (const [, custOrds] of customerOrders) allOrders.push(...custOrds);

  for (const order of allOrders) {
    const dateStr = order.created_at.split('T')[0];
    const bucket = getOrCreate(dateStr);

    const grossSales = parseFloat(order.subtotal_price) + parseFloat(order.total_discounts);
    const discounts = -Math.abs(parseFloat(order.total_discounts));
    const taxes = parseFloat(order.total_tax);
    const shipping = parseFloat(order.total_shipping_price_set?.shop_money?.amount || '0');
    const orderTotal = parseFloat(order.subtotal_price);

    // NC = guest order OR first order for this customer
    const isNewCustomer = !order.customer || firstOrderIds.has(order.id);

    if (isNewCustomer) {
      bucket.nc_orders += 1;
      bucket.nc_revenue += orderTotal;
    } else {
      bucket.rc_orders += 1;
      bucket.rc_revenue += orderTotal;
    }

    bucket.gross_sales += grossSales;
    bucket.discounts += discounts;
    bucket.taxes += taxes;
    bucket.shipping += shipping;

    // Process refunds — attribute to the day the refund was created
    for (const refund of order.refunds || []) {
      const refundDate = refund.created_at.split('T')[0];
      const refundBucket = getOrCreate(refundDate);

      let refundAmount = 0;
      for (const txn of refund.transactions || []) {
        if (txn.kind === 'refund') {
          refundAmount += parseFloat(txn.amount);
        }
      }
      refundBucket.refunds -= Math.abs(refundAmount);
    }
  }

  return buckets;
}

// ─── POST handler ───────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Auth check — admin only
  const authHeader = request.headers.get('authorization');
  if (!authHeader) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const token = authHeader.replace('Bearer ', '');
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser(token);
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from('users_profile')
    .select('role')
    .eq('id', user.id)
    .single();

  if (!profile || !['admin', 'founder'].includes(profile.role)) {
    return NextResponse.json({ error: 'Forbidden — admin/founder only' }, { status: 403 });
  }

  // Parse body
  const body = await request.json();
  const { brand_id, since_date, until_date } = body;

  if (!brand_id) {
    return NextResponse.json({ error: 'brand_id is required' }, { status: 400 });
  }

  // Get brand's Shopify credentials + ad account IDs
  const { data: brand, error: brandError } = await supabase
    .from('brands')
    .select('id, name, shopify_store_domain, shopify_client_id, shopify_client_secret, meta_ad_account_id, google_ads_customer_id')
    .eq('id', brand_id)
    .single();

  if (brandError || !brand) {
    return NextResponse.json({ error: 'Brand not found' }, { status: 404 });
  }

  if (!brand.shopify_store_domain || !brand.shopify_client_id || !brand.shopify_client_secret) {
    return NextResponse.json(
      { error: 'Shopify not connected for this brand. Add store domain, client ID, and client secret first.' },
      { status: 400 }
    );
  }

  // ── Rate limit: 5 syncs per minute per brand ──
  const limiter = getSyncRateLimiter();
  if (limiter) {
    const { success, reset } = await limiter.limit(`brand:${brand.id}`);
    if (!success) {
      const retryAfter = Math.ceil((reset - Date.now()) / 1000);
      return NextResponse.json(
        { error: 'Rate limit exceeded — try again in a moment.', retry_after_seconds: retryAfter },
        { status: 429 }
      );
    }
  }

  // ── Acquire per-brand lock so concurrent syncs can't collide ──
  const gotLock = await acquireSyncLock(brand.id, 180);
  if (!gotLock) {
    return NextResponse.json(
      { error: 'A sync is already running for this brand. Wait for it to finish.' },
      { status: 409 }
    );
  }

  // Default date range: last 30 days (covers MTD always)
  const now = new Date();
  const defaultSince = new Date(now);
  defaultSince.setDate(defaultSince.getDate() - 30);

  const sinceDate = since_date || defaultSince.toISOString();
  const untilDate = until_date || now.toISOString();

  try {
    // Exchange client credentials for access token (valid 24h)
    const shopifyToken = await getShopifyToken(
      brand.shopify_store_domain,
      brand.shopify_client_id,
      brand.shopify_client_secret
    );

    // Fetch orders from Shopify
    const orders = await fetchAllOrders(
      brand.shopify_store_domain,
      shopifyToken,
      sinceDate,
      untilDate
    );

    // Aggregate by day
    const dayBuckets = aggregateOrdersByDay(orders);

    // Upsert into daily_pnl
    const rows = Array.from(dayBuckets.entries()).map(([date, bucket]) => ({
      brand_id: brand.id,
      date,
      nc_orders: bucket.nc_orders,
      nc_revenue: Math.round(bucket.nc_revenue * 100) / 100,
      rc_orders: bucket.rc_orders,
      rc_revenue: Math.round(bucket.rc_revenue * 100) / 100,
      gross_sales: Math.round(bucket.gross_sales * 100) / 100,
      discounts: Math.round(bucket.discounts * 100) / 100,
      refunds: Math.round(bucket.refunds * 100) / 100,
      taxes: Math.round(bucket.taxes * 100) / 100,
      shipping: Math.round(bucket.shipping * 100) / 100,
      synced_at: new Date().toISOString(),
    }));

    if (rows.length > 0) {
      const { error: upsertError } = await supabase
        .from('daily_pnl')
        .upsert(rows, { onConflict: 'brand_id,date' });

      if (upsertError) {
        console.error('Upsert error:', upsertError);
        return NextResponse.json({ error: 'Failed to save data', details: upsertError.message }, { status: 500 });
      }
    }

    // ── Sync ad spend from Google Ads (Windsor) + Meta in parallel ──
    const adSpendErrors: string[] = [];
    let googleDaysSynced = 0;
    let metaDaysSynced = 0;

    const fetchGoogle = async (): Promise<Map<string, number>> => {
      const dailyGoogle = new Map<string, number>();
      if (!brand.google_ads_customer_id || !brand.google_ads_customer_id.trim()) return dailyGoogle;
      const windsorKey = process.env.WINDSOR_API_KEY || '';
      if (!windsorKey) return dailyGoogle;
      try {
        const custId = brand.google_ads_customer_id.replace(/(\d{3})(\d{3})(\d{4})/, '$1-$2-$3');
        const windsorUrl = new URL('https://connectors.windsor.ai/google_ads');
        windsorUrl.searchParams.set('api_key', windsorKey);
        windsorUrl.searchParams.set('date_from', sinceDate.split('T')[0]);
        windsorUrl.searchParams.set('date_to', untilDate.split('T')[0]);
        windsorUrl.searchParams.set('fields', 'account_id,date,spend');
        windsorUrl.searchParams.set('_renderer', 'json');
        const wRes = await fetch(windsorUrl.toString());
        const wData = await wRes.json();
        const wRows = Array.isArray(wData) ? wData
          : wData?.data ? wData.data
          : wData?.result ? wData.result : [];
        for (const r of wRows) {
          if (r.account_id !== custId) continue;
          dailyGoogle.set(r.date, (dailyGoogle.get(r.date) || 0) + (r.spend || 0));
        }
      } catch (e: any) {
        adSpendErrors.push(`Google: ${e.message}`);
      }
      return dailyGoogle;
    };

    const fetchMeta = async (): Promise<Map<string, number>> => {
      const dailyMeta = new Map<string, number>();
      if (!brand.meta_ad_account_id || !brand.meta_ad_account_id.trim()) return dailyMeta;
      const metaToken = process.env.META_ACCESS_TOKEN || '';
      if (!metaToken) return dailyMeta;
      try {
        const metaUrl = `https://graph.facebook.com/v21.0/${brand.meta_ad_account_id}/insights?` +
          `time_range=${encodeURIComponent(JSON.stringify({ since: sinceDate.split('T')[0], until: untilDate.split('T')[0] }))}` +
          `&time_increment=1&fields=spend&limit=500&access_token=${metaToken}`;
        const mRes = await fetch(metaUrl);
        const mData = await mRes.json();
        if (mData.data && mData.data.length > 0) {
          for (const r of mData.data) {
            dailyMeta.set(r.date_start, parseFloat(r.spend || '0'));
          }
        }
      } catch (e: any) {
        adSpendErrors.push(`Meta: ${e.message}`);
      }
      return dailyMeta;
    };

    // Run Google + Meta fetches concurrently
    const [dailyGoogle, dailyMeta] = await Promise.all([fetchGoogle(), fetchMeta()]);

    // Build a single merged upsert payload keyed by date
    const adSpendByDate = new Map<string, { google_spend?: number; meta_spend?: number }>();
    for (const [date, spend] of dailyGoogle) {
      adSpendByDate.set(date, { google_spend: Math.round(spend * 100) / 100 });
    }
    for (const [date, spend] of dailyMeta) {
      const existing = adSpendByDate.get(date) || {};
      existing.meta_spend = Math.round(spend * 100) / 100;
      adSpendByDate.set(date, existing);
    }

    if (adSpendByDate.size > 0) {
      const adRows = Array.from(adSpendByDate.entries()).map(([date, vals]) => ({
        brand_id: brand.id,
        date,
        ...vals,
      }));
      const { error: adErr } = await supabase
        .from('daily_pnl')
        .upsert(adRows, { onConflict: 'brand_id,date' });
      if (adErr) {
        adSpendErrors.push(`Ad spend upsert: ${adErr.message}`);
      } else {
        googleDaysSynced = dailyGoogle.size;
        metaDaysSynced = dailyMeta.size;
      }
    }

    // Invalidate the cached P&L for this brand so the next GET returns fresh data
    await invalidatePnlCache(brand.id);

    return NextResponse.json({
      success: true,
      brand: brand.name,
      orders_processed: orders.length,
      days_synced: rows.length,
      google_spend_days: googleDaysSynced,
      meta_spend_days: metaDaysSynced,
      ad_spend_errors: adSpendErrors.length > 0 ? adSpendErrors : undefined,
      date_range: { from: sinceDate.split('T')[0], to: untilDate.split('T')[0] },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('Shopify sync error:', message);
    return NextResponse.json({ error: 'Shopify sync failed', details: message }, { status: 500 });
  } finally {
    await releaseSyncLock(brand.id);
  }
}

// ─── GET handler — fetch synced daily_pnl data ─────────────────

export async function GET(request: NextRequest) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Auth check
  const authHeader = request.headers.get('authorization');
  if (!authHeader) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const token = authHeader.replace('Bearer ', '');
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser(token);
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
  const brandId = searchParams.get('brand_id');
  const year = searchParams.get('year') || new Date().getFullYear().toString();

  if (!brandId) {
    return NextResponse.json({ error: 'brand_id is required' }, { status: 400 });
  }

  // Strategists and founders can only see their own brand
  if (['strategist', 'founder'].includes(profile.role) && profile.brand_id !== brandId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    // ── Try cache first (60s TTL) ──
    const cached = await getCachedPnl(brandId, year);
    if (cached) {
      return NextResponse.json(cached, {
        headers: { 'X-Cache': 'HIT' },
      });
    }

    const { data: rows, error } = await supabase
      .from('daily_pnl')
      .select('*')
      .eq('brand_id', brandId)
      .gte('date', `${year}-01-01`)
      .lte('date', `${year}-12-31`)
      .order('date', { ascending: false });

    if (error) {
      return NextResponse.json({ error: 'Failed to fetch data', details: error.message }, { status: 500 });
    }

    // Also get brand's Shopify connection status
    const { data: brand } = await supabase
      .from('brands')
      .select('shopify_store_domain, shopify_client_id, shopify_gross_margin_pct')
      .eq('id', brandId)
      .single();

    const payload = {
      rows: rows || [],
      shopify_connected: !!(brand?.shopify_store_domain && brand?.shopify_client_id),
      gross_margin_pct: brand?.shopify_gross_margin_pct || 62,
    };

    // Fire-and-forget cache write
    await setCachedPnl(brandId, year, payload, 60);

    return NextResponse.json(payload, {
      headers: { 'X-Cache': 'MISS' },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
