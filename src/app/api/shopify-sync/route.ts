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
export const maxDuration = 300; // Shopify pagination + customer enrichment + ad spend sync

// ─── Types ──────────────────────────────────────────────────────

interface ShopifyOrder {
  id: number;
  name: string;
  created_at: string;
  updated_at: string;
  financial_status: string;
  fulfillment_status: string | null;
  total_price: string;
  subtotal_price: string;
  total_discounts: string;
  total_tax: string;
  currency: string;
  total_shipping_price_set: {
    shop_money: { amount: string };
  };
  shipping_lines: {
    discounted_price_set?: { shop_money: { amount: string } };
    discounted_price?: string;
    price: string;
  }[];
  refunds: ShopifyRefund[];
  customer: {
    id: number;
    orders_count: number;
  } | null;
  email: string | null;
  line_items: {
    price: string;
    quantity: number;
  }[];
  shipping_address: Record<string, unknown> | null;
  billing_address: Record<string, unknown> | null;
  source_name: string | null;
  landing_site: string | null;
  referring_site: string | null;
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
    // NOTE: do NOT use the `fields` filter here — Shopify strips nested
    // defaults (e.g. customer.orders_count) which we need for accurate
    // NC vs RC classification. Full payload is fine.
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

// ─── Enrich orders with reliable lifetime order counts ─────────
// The embedded `customer.orders_count` on the orders endpoint is unreliable
// (often missing/zero). Fetch each unique customer directly to get the
// authoritative lifetime count, then stamp it on every order in this window.
async function enrichCustomerOrderCounts(
  domain: string,
  token: string,
  orders: ShopifyOrder[]
): Promise<void> {
  const uniqueCustomerIds = new Set<number>();
  for (const o of orders) {
    if (o.customer?.id) uniqueCustomerIds.add(o.customer.id);
  }

  const counts = new Map<number, number>();
  const ids = Array.from(uniqueCustomerIds);
  // Shopify GraphQL `nodes(ids: [...])` supports batch lookup. Chunk to 100
  // per request to stay well under cost limits.
  const CHUNK = 100;

  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK);
    const gids = slice.map((id) => `gid://shopify/Customer/${id}`);
    const query = `query($ids: [ID!]!) {
      nodes(ids: $ids) {
        ... on Customer {
          id
          numberOfOrders
        }
      }
    }`;
    try {
      const res = await fetch(
        `https://${domain}/admin/api/2024-01/graphql.json`,
        {
          method: 'POST',
          headers: {
            'X-Shopify-Access-Token': token,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ query, variables: { ids: gids } }),
        }
      );
      if (!res.ok) continue;
      const j = (await res.json()) as {
        data?: { nodes?: Array<{ id?: string; numberOfOrders?: string | number } | null> };
      };
      const nodes = j.data?.nodes || [];
      for (const n of nodes) {
        if (!n?.id) continue;
        const numericId = Number(n.id.split('/').pop());
        const num = typeof n.numberOfOrders === 'string'
          ? parseInt(n.numberOfOrders, 10)
          : n.numberOfOrders;
        if (numericId && typeof num === 'number' && !isNaN(num)) {
          counts.set(numericId, num);
        }
      }
    } catch {
      // Skip chunk on failure
    }
  }

  for (const o of orders) {
    if (o.customer?.id && counts.has(o.customer.id)) {
      (o as ShopifyOrder & { lifetimeOrdersCount?: number }).lifetimeOrdersCount =
        counts.get(o.customer.id);
    }
  }
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

  // Build set of first-order IDs per customer. We rely on lifetimeOrdersCount
  // which is populated by the caller (fetched via /customers/{id}.json — the
  // embedded customer object on orders is unreliable for orders_count).
  const firstOrderIds = new Set<number>();
  for (const [, custOrds] of customerOrders) {
    custOrds.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    const enriched = custOrds[0] as ShopifyOrder & { lifetimeOrdersCount?: number };
    const lifetimeCount = enriched.lifetimeOrdersCount ?? 0;
    if (lifetimeCount > 0) {
      // Enrichment succeeded — use reliable lifetime count
      if (lifetimeCount <= custOrds.length) {
        firstOrderIds.add(custOrds[0].id);
      }
    } else {
      // Enrichment failed (lifetimeCount=0) — fall back to embedded orders_count
      const embeddedCount = custOrds[0].customer?.orders_count ?? 0;
      if (embeddedCount <= 1 || embeddedCount <= custOrds.length) {
        firstOrderIds.add(custOrds[0].id);
      }
    }
  }

  // Process all non-voided orders
  const allOrders = [...guestOrders];
  for (const [, custOrds] of customerOrders) allOrders.push(...custOrds);

  for (const order of allOrders) {
    const dateStr = order.created_at.split('T')[0];
    const bucket = getOrCreate(dateStr);

    const subtotal = parseFloat(order.subtotal_price);
    const totalDiscounts = parseFloat(order.total_discounts);
    const grossSales = subtotal + totalDiscounts;
    const discounts = -Math.abs(totalDiscounts);
    const taxes = parseFloat(order.total_tax);
    // Use post-discount shipping (what customer actually paid), not gross shipping price
    const shipping = (order.shipping_lines || []).reduce((sum: number, line) => {
      return sum + parseFloat(line.discounted_price_set?.shop_money?.amount || line.discounted_price || line.price || '0');
    }, 0);

    // NC = guest order OR first order for this customer
    const isNewCustomer = !order.customer || firstOrderIds.has(order.id);

    // Use grossSales (subtotal + discounts) for NC/RC revenue so the proportional
    // split in calcFields reconciles with the grossSales total
    if (isNewCustomer) {
      bucket.nc_orders += 1;
      bucket.nc_revenue += grossSales;
    } else {
      bucket.rc_orders += 1;
      bucket.rc_revenue += grossSales;
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
  const { brand_id, since_date, until_date, action } = body;
  const spendOnly = action === 'sync_spend_only';

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

  if (!brand.shopify_store_domain && !spendOnly) {
    return NextResponse.json(
      { error: 'Shopify not connected for this brand. Install the Melch.Cloud app on your store first.' },
      { status: 400 }
    );
  }

  // Resolve Shopify auth (skip for spend-only mode)
  let oauthAccessToken: string | null = null;
  if (!spendOnly) {
    if (brand.shopify_store_domain) {
      const { data: storeRow } = await supabase
        .from('shopify_stores')
        .select('access_token, uninstalled_at')
        .eq('shop_domain', brand.shopify_store_domain)
        .maybeSingle();
      if (storeRow?.access_token && !storeRow.uninstalled_at) {
        oauthAccessToken = storeRow.access_token;
      }
    }

    if (!oauthAccessToken && (!brand.shopify_client_id || !brand.shopify_client_secret)) {
      return NextResponse.json(
        { error: 'Shopify not connected for this brand. Install the Melch.Cloud app on your store first.' },
        { status: 400 }
      );
    }
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
  const gotLock = await acquireSyncLock(brand.id, 360);
  if (!gotLock) {
    return NextResponse.json(
      { error: 'A sync is already running for this brand. Wait for it to finish.' },
      { status: 409 }
    );
  }

  // Default date range: last 30 days (covers MTD always)
  const now = new Date();
  const defaultSince = new Date(now);
  defaultSince.setDate(defaultSince.getDate() - 60);

  const sinceDate = since_date || defaultSince.toISOString();
  const untilDate = until_date || now.toISOString();

  try {
    let ordersProcessed = 0;
    let daysSynced = 0;
    let productsSynced = 0;

    // ── Ad spend fetch functions (shared by full-sync and spend-only paths) ──
    const adSpendErrors: string[] = [];
    let googleDaysSynced = 0;
    let metaDaysSynced = 0;

    const fetchGoogle = async (): Promise<Map<string, number>> => {
      const dailyGoogle = new Map<string, number>();
      if (!brand.google_ads_customer_id || !brand.google_ads_customer_id.trim()) return dailyGoogle;
      let windsorKey = process.env.WINDSOR_API_KEY || '';
      if (!windsorKey) {
        const { data: settings } = await supabase
          .from('app_settings')
          .select('value')
          .eq('key', 'windsor_api_key')
          .single();
        windsorKey = settings?.value || '';
      }
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

    // ── Shopify order sync (skip if spend-only mode) ──
    if (!spendOnly) {
    const shopifyToken = oauthAccessToken
      ? oauthAccessToken
      : await getShopifyToken(
          brand.shopify_store_domain,
          brand.shopify_client_id!,
          brand.shopify_client_secret!
        );

    const orders = await fetchAllOrders(
      brand.shopify_store_domain,
      shopifyToken,
      sinceDate,
      untilDate
    );

    try {
      await enrichCustomerOrderCounts(brand.shopify_store_domain, shopifyToken, orders);
    } catch (e) {
      console.error('Customer enrichment failed (non-fatal):', e);
    }

    const dayBuckets = aggregateOrdersByDay(orders);

    // Fetch ad spend in parallel with order processing
    const [dailyGoogle, dailyMeta] = await Promise.all([fetchGoogle(), fetchMeta()]);

    // Build order rows WITH spend data merged in
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
      // Merge spend data if we have it for this date — omit if not available
      // so Supabase won't overwrite existing spend values
      ...(dailyMeta.has(date) ? { meta_spend: Math.round(dailyMeta.get(date)! * 100) / 100 } : {}),
      ...(dailyGoogle.has(date) ? { google_spend: Math.round(dailyGoogle.get(date)! * 100) / 100 } : {}),
    }));

    googleDaysSynced = dailyGoogle.size;
    metaDaysSynced = dailyMeta.size;

    if (rows.length > 0) {
      const { error: upsertError } = await supabase
        .from('daily_pnl')
        .upsert(rows, { onConflict: 'brand_id,date' });

      if (upsertError) {
        console.error('Upsert error:', upsertError);
        return NextResponse.json({ error: 'Failed to save data', details: upsertError.message }, { status: 500 });
      }
    }

    // Upsert any spend-only dates (dates with ad spend but no orders)
    const orderDates = new Set(dayBuckets.keys());
    const spendOnlyRows: any[] = [];
    const allSpendDates = new Set([...dailyGoogle.keys(), ...dailyMeta.keys()]);

    for (const date of allSpendDates) {
      if (!orderDates.has(date)) {
        spendOnlyRows.push({
          brand_id: brand.id,
          date,
          ...(dailyMeta.has(date) ? { meta_spend: Math.round(dailyMeta.get(date)! * 100) / 100 } : {}),
          ...(dailyGoogle.has(date) ? { google_spend: Math.round(dailyGoogle.get(date)! * 100) / 100 } : {}),
        });
      }
    }

    if (spendOnlyRows.length > 0) {
      const { error: spendOnlyErr } = await supabase
        .from('daily_pnl')
        .upsert(spendOnlyRows, { onConflict: 'brand_id,date' });
      if (spendOnlyErr) {
        adSpendErrors.push(`Spend-only upsert: ${spendOnlyErr.message}`);
      }
    }

    // ── Upsert raw orders into shopify_orders for landing page analytics ──
    if (orders.length > 0) {
      const CHUNK_SIZE = 200;
      let orderUpsertErrors = 0;
      for (let i = 0; i < orders.length; i += CHUNK_SIZE) {
        const chunk = orders.slice(i, i + CHUNK_SIZE);
        const orderRows = chunk.map((o) => ({
          shop_domain: brand.shopify_store_domain,
          brand_id: brand.id,
          shopify_order_id: o.id,
          order_number: o.name ?? null,
          email: o.email ?? null,
          total_price: o.total_price ?? null,
          subtotal_price: o.subtotal_price ?? null,
          total_tax: o.total_tax ?? null,
          total_discounts: o.total_discounts ?? null,
          currency: o.currency ?? null,
          financial_status: o.financial_status ?? null,
          fulfillment_status: o.fulfillment_status ?? null,
          customer_id: o.customer?.id ?? null,
          line_items: o.line_items ?? [],
          shipping_address: o.shipping_address ?? null,
          billing_address: o.billing_address ?? null,
          source_name: o.source_name ?? null,
          landing_site: o.landing_site ?? null,
          referring_site: o.referring_site ?? null,
          shopify_created_at: o.created_at,
          shopify_updated_at: o.updated_at,
          raw: o,
          updated_at: new Date().toISOString(),
        }));
        const { error: rawErr } = await supabase
          .from('shopify_orders')
          .upsert(orderRows, { onConflict: 'shop_domain,shopify_order_id' });
        if (rawErr) {
          console.error('Raw order upsert error (chunk):', rawErr.message);
          orderUpsertErrors++;
        }
      }
      if (orderUpsertErrors > 0) {
        console.warn(`shopify_orders upsert: ${orderUpsertErrors} chunk(s) failed`);
      }
    }

    ordersProcessed = orders.length;
    daysSynced = rows.length;

    // ── Sync Shopify products alongside orders ──
    try {
      let allProducts: any[] = [];
      let nextProductUrl: string | null = null;

      const firstProducts = await shopifyFetch(
        brand.shopify_store_domain,
        shopifyToken,
        'products',
        { limit: '250', status: 'active' }
      );
      const firstProductData = firstProducts.data as { products: any[] };
      allProducts.push(...firstProductData.products);
      nextProductUrl = firstProducts.nextLink;

      while (nextProductUrl) {
        const res = await fetch(nextProductUrl, {
          headers: {
            'X-Shopify-Access-Token': shopifyToken,
            'Content-Type': 'application/json',
          },
        });
        if (!res.ok) break;
        const linkHeader = res.headers.get('Link') || '';
        const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
        nextProductUrl = nextMatch ? nextMatch[1] : null;
        const data = (await res.json()) as { products: any[] };
        allProducts.push(...data.products);
        await new Promise((r) => setTimeout(r, 100));
      }

      if (allProducts.length > 0) {
        const productRows = allProducts.map((p) => ({
          shop_domain: brand.shopify_store_domain,
          brand_id: brand.id,
          shopify_product_id: p.id,
          title: p.title,
          handle: p.handle,
          status: p.status,
          product_type: p.product_type || '',
          vendor: p.vendor || '',
          tags: p.tags ? p.tags.split(', ') : [],
          variants: p.variants || [],
          images: p.images || [],
          shopify_created_at: p.created_at,
          shopify_updated_at: p.updated_at,
          raw: p,
          updated_at: new Date().toISOString(),
        }));

        const CHUNK = 200;
        for (let i = 0; i < productRows.length; i += CHUNK) {
          const chunk = productRows.slice(i, i + CHUNK);
          const { error: prodErr } = await supabase
            .from('shopify_products')
            .upsert(chunk, { onConflict: 'shop_domain,shopify_product_id' });
          if (prodErr) {
            console.error('Product upsert error:', prodErr.message);
          }
        }
        productsSynced = allProducts.length;
      }
    } catch (e) {
      console.error('Product sync failed (non-fatal):', e);
    }

    } else {
      // ── Spend-only mode: fetch and upsert ad spend without touching order columns ──
      const [dailyGoogle, dailyMeta] = await Promise.all([fetchGoogle(), fetchMeta()]);

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
    }

    // Invalidate the cached P&L for this brand so the next GET returns fresh data
    await invalidatePnlCache(brand.id);

    return NextResponse.json({
      success: true,
      brand: brand.name,
      mode: spendOnly ? 'spend_only' : 'full',
      orders_processed: ordersProcessed,
      products_synced: productsSynced,
      days_synced: daysSynced,
      google_spend_days: googleDaysSynced,
      meta_spend_days: metaDaysSynced,
      ad_spend_errors: adSpendErrors.length > 0 ? adSpendErrors : undefined,
      date_range: { from: sinceDate.split('T')[0], to: untilDate.split('T')[0] },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('Shopify sync error:', message);

    // Fire-and-forget alert email (rate-limited 1h per brand)
    try {
      const { sendEmail } = await import('@/lib/email');
      await sendEmail({
        to: process.env.ADMIN_NOTIFICATION_EMAIL || 'melch@melch.media',
        template: {
          name: 'sync-failure',
          data: {
            brandName: brand.name,
            brandId: brand.id,
            source: 'shopify',
            errorMessage: message,
            context: {
              'Since Date': sinceDate.split('T')[0],
              'Until Date': untilDate.split('T')[0],
            },
          },
        },
        dedupeKey: `sync-failure:shopify:${brand.id}`,
        dedupeTtlSeconds: 3600,
      });
    } catch (alertErr) {
      console.error('Failed to send sync failure alert:', alertErr);
    }

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

    // Also get brand's Shopify connection status. A brand is "connected" if
    // it has either (a) a live public-app OAuth install in shopify_stores, or
    // (b) custom-distribution client credentials on the brand row.
    const { data: brand } = await supabase
      .from('brands')
      .select('shopify_store_domain, shopify_client_id, gross_margin_pct')
      .eq('id', brandId)
      .single();

    let hasOauthInstall = false;
    if (brand?.shopify_store_domain) {
      const { data: storeRow } = await supabase
        .from('shopify_stores')
        .select('access_token, uninstalled_at')
        .eq('shop_domain', brand.shopify_store_domain)
        .maybeSingle();
      hasOauthInstall = !!(storeRow?.access_token && !storeRow.uninstalled_at);
    }

    // Get last synced timestamp
    const lastSyncedRow = (rows && rows.length > 0)
      ? rows.reduce((latest: any, r: any) => (!latest || r.synced_at > latest.synced_at) ? r : latest, null)
      : null;

    const payload = {
      rows: rows || [],
      shopify_connected: !!(
        brand?.shopify_store_domain && (hasOauthInstall || brand.shopify_client_id)
      ),
      gross_margin_pct: brand?.gross_margin_pct || 62,
      last_synced_at: lastSyncedRow?.synced_at || null,
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
