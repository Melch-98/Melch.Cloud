import { NextResponse } from 'next/server';
import {
  getSyncRateLimiter,
  acquireSyncLock,
  releaseSyncLock,
  invalidatePnlCache,
} from '@/lib/redis';
import {
  currencyFromShopInfo,
  getFxRates,
  normalizeCurrencyCode,
  resolveReportingCurrency,
  toReportingCurrency,
} from '@/lib/currency';
import { fetchGoogleAdsCurrency } from '@/lib/pipeboard-google';
import { exchangeClientCredentials } from '@/lib/shopify/client-credentials';
import { SHOPIFY_CONFIG } from '@/lib/shopify/config';
import { fetchDailyAdSpend } from '@/lib/shopify/fetch-ad-spend';
import { readShopifyAmount, shopifyProductTags, shopifyProductsFromPayload } from '@/lib/shopify/rest-payload';
import { collectPagedOrders, ordersFromPayload, type OrdersPageResult } from '@/lib/shopify/orders-pages';
import { buildFullCoveredDayRows, buildSpendOnlyCoveredDayRows } from '@/lib/shopify/pnl-covered-days';
import { aggregateOrdersByDay, type PnlShopifyOrder } from '@/lib/shopify/pnl-days';
import { resolveShopIanaTimeZone } from '@/lib/shopify/shop-timezone';
import { addCalendarDays, fullyCoveredShopDays, ymdInTimeZone, zonedMidnight } from '@/lib/shopify/shop-time';
import { upsertDailyPnl } from '@/lib/shopify/upsert-daily-pnl';

// ─── Types ──────────────────────────────────────────────────────

interface ShopifyOrder {
  id: number;
  name: string;
  created_at: string;
  updated_at: string;
  financial_status: string;
  fulfillment_status: string | null;
  total_price: string;
  total_price_set?: unknown;
  subtotal_price: string;
  subtotal_price_set?: unknown;
  total_discounts: string;
  total_discounts_set?: unknown;
  total_tax: string;
  total_tax_set?: unknown;
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

// ─── Reporting currency + spend FX ──────────────────────────────

export function convertSpendMap(
  daily: Map<string, number>,
  native: string,
  reporting: string,
  rates: Record<string, number>
): Map<string, number> {
  const from = normalizeCurrencyCode(native);
  const to = normalizeCurrencyCode(reporting);
  if (from === to) return daily;
  const out = new Map<string, number>();
  Array.from(daily.entries()).forEach(([date, amount]) => {
    out.set(date, Math.round(toReportingCurrency(amount, from, to, rates) * 100) / 100);
  });
  return out;
}

export async function fetchMetaAccountCurrency(
  adAccountId: string | null | undefined,
  metaToken: string
): Promise<string | null> {
  if (!adAccountId || !adAccountId.trim() || !metaToken) return null;
  try {
    const res = await fetch(
      `https://graph.facebook.com/v21.0/${adAccountId}?fields=currency&access_token=${metaToken}`
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data?.currency ? normalizeCurrencyCode(data.currency) : null;
  } catch {
    return null;
  }
}

export async function fetchGoogleAccountCurrency(
  customerId: string | null | undefined,
  pipeboardToken: string
): Promise<string | null> {
  return fetchGoogleAdsCurrency(pipeboardToken, customerId);
}

export async function resolveBrandReportingCurrency(
  supabase: any,
  brand: { id: string; shopify_store_domain?: string | null },
  orderCurrencies: Array<string | null | undefined> = [],
  metaCurrency?: string | null,
  googleCurrency?: string | null
): Promise<{ code: string; source: string }> {
  let shopCurrency: string | null = null;
  if (brand.shopify_store_domain) {
    const { data: storeRow } = await supabase
      .from('shopify_stores')
      .select('shop_info')
      .eq('shop_domain', brand.shopify_store_domain)
      .maybeSingle();
    shopCurrency = currencyFromShopInfo(storeRow?.shop_info);
  }

  // If shop_info missing, sample recent shopify_orders currencies (no inventing).
  if (!shopCurrency && orderCurrencies.length === 0) {
    const { data: sample } = await supabase
      .from('shopify_orders')
      .select('currency')
      .eq('brand_id', brand.id)
      .not('currency', 'is', null)
      .limit(50);
    if (sample?.length) {
      orderCurrencies = sample.map((r: { currency?: string }) => r.currency);
    }
  }

  return resolveReportingCurrency({
    shopCurrency,
    orderCurrencies,
    metaCurrency,
    googleCurrency,
  });
}

// ─── Shopify API helper ─────────────────────────────────────────

async function shopifyFetch(
  domain: string,
  token: string,
  endpoint: string,
  params: Record<string, string> = {}
): Promise<{ data: unknown; nextLink: string | null }> {
  const url = new URL(`https://${domain}/admin/api/${SHOPIFY_CONFIG.apiVersion}/${endpoint}.json`);
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
  const firstOrders = ordersFromPayload(first.data) as ShopifyOrder[];
  const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
  return collectPagedOrders(firstOrders, first.nextLink, (url) => readShopifyOrdersPage(url, token), sleep, 100);
}

async function readShopifyOrdersPage(url: string, token: string): Promise<OrdersPageResult> {
  const res = await fetch(url, {
    headers: {
      'X-Shopify-Access-Token': token,
      'Content-Type': 'application/json',
    },
  });
  return {
    ok: res.ok,
    status: res.status,
    retryAfter: res.headers.get('Retry-After'),
    link: res.headers.get('Link'),
    body: res.ok ? await res.json() : null,
  };
}

// ─── Enrich orders with reliable lifetime order counts ─────────
// The embedded `customer.orders_count` on the orders endpoint is unreliable
// (often missing/zero). Fetch each unique customer directly to get the
// authoritative lifetime count, then stamp it on every order in this window.
export async function enrichCustomerOrderCounts(
  domain: string,
  token: string,
  orders: Array<PnlShopifyOrder & { customer: { id: number; orders_count?: number } | null }>
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
        `https://${domain}/admin/api/${SHOPIFY_CONFIG.apiVersion}/graphql.json`,
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
      o.lifetimeOrdersCount = counts.get(o.customer.id);
    }
  }
}

// ─── Shared Daily P&L sync (manual route and cron) ─────────────

export type ShopifyPnlSyncInput = {
  brand_id?: string;
  since_date?: string;
  until_date?: string;
  action?: string;
};

/**
 * The Daily P&L write used by POST /api/shopify-sync.
 * The scheduled refresh calls this directly so it cannot drift from the manual route.
 */
export async function runShopifyBrandSync(
  supabase: { from: (table: string) => any },
  input: ShopifyPnlSyncInput
): Promise<NextResponse> {
  const { brand_id, since_date, until_date, action } = input;
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
      if (
        storeRow?.access_token &&
        storeRow.access_token !== 'gadget-managed' &&
        !storeRow.uninstalled_at
      ) {
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

  // Default date range: last 60 shop-local days, from local midnight.
  const now = new Date();
  let sinceDate = since_date || '';
  let untilDate = until_date || '';
  let timeZone = 'UTC';

  try {
    let ordersProcessed = 0;
    let daysSynced = 0;
    let productsSynced = 0;
    const adSpendErrors: string[] = [];
    let googleDaysSynced = 0;
    let metaDaysSynced = 0;

    let shopifyToken = oauthAccessToken;
    if (!spendOnly && !shopifyToken) {
      shopifyToken = (
        await exchangeClientCredentials(
          brand.shopify_store_domain,
          brand.shopify_client_id!,
          brand.shopify_client_secret!
        )
      ).accessToken;
    }
    const zone = await resolveShopIanaTimeZone(supabase, brand, shopifyToken);
    timeZone = zone.timeZone;
    if (!sinceDate) {
      const today = ymdInTimeZone(now, timeZone);
      sinceDate = zonedMidnight(addCalendarDays(today, -60), timeZone).toISOString();
    }
    if (!untilDate) untilDate = now.toISOString();
    const spendFrom = ymdInTimeZone(new Date(sinceDate), timeZone);
    const spendTo = ymdInTimeZone(new Date(untilDate), timeZone);
    const coveredDays = fullyCoveredShopDays(sinceDate, untilDate, timeZone);

    // ── Shopify order sync (skip if spend-only mode) ──
    if (!spendOnly) {
    if (!shopifyToken) throw new Error('Shopify access token missing');

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

    const dayBuckets = aggregateOrdersByDay(orders, timeZone);

    // Fetch ad spend for the shop-local dates the window touches.
    const nativeSpend = await fetchDailyAdSpend(supabase, brand, spendFrom, spendTo);
    adSpendErrors.push(...nativeSpend.errors);
    const dailyGoogleNative = nativeSpend.google;
    const dailyMetaNative = nativeSpend.meta;

    // Resolve reporting currency (Shopify settlement) + convert Meta/Google spend into it.
    const metaTokenForFx = process.env.META_ACCESS_TOKEN || '';
    let pipeboardTokenForFx = process.env.PIPEBOARD_API_TOKEN || '';
    if (!pipeboardTokenForFx) {
      const { data: pbSettings } = await supabase
        .from('app_settings')
        .select('value')
        .eq('key', 'pipeboard_api_token')
        .single();
      pipeboardTokenForFx = pbSettings?.value || '';
    }
    const [metaCurrency, googleCurrency, fxRates] = await Promise.all([
      fetchMetaAccountCurrency(brand.meta_ad_account_id, metaTokenForFx),
      fetchGoogleAccountCurrency(brand.google_ads_customer_id, pipeboardTokenForFx),
      getFxRates(),
    ]);
    const reporting = await resolveBrandReportingCurrency(
      supabase,
      brand,
      orders.map((o) => o.currency),
      metaCurrency,
      googleCurrency
    );
    const dailyMeta = convertSpendMap(
      dailyMetaNative,
      metaCurrency || reporting.code,
      reporting.code,
      fxRates
    );
    const dailyGoogle = convertSpendMap(
      dailyGoogleNative,
      googleCurrency || reporting.code,
      reporting.code,
      fxRates
    );

    // One row per fully covered shop-local day, including days with zero
    // orders. A successful spend fetch writes 0 for days it omitted. A failed
    // fetch omits that column. Partial edge days are not in coveredDays.
    const rows = buildFullCoveredDayRows({
      brandId: brand.id,
      currency: reporting.code,
      syncedAt: new Date().toISOString(),
      coveredDays,
      buckets: dayBuckets,
      meta: { ok: nativeSpend.metaOk, byDay: dailyMeta },
      google: { ok: nativeSpend.googleOk, byDay: dailyGoogle },
    });

    googleDaysSynced = rows.filter((row) => row.google_spend != null).length;
    metaDaysSynced = rows.filter((row) => row.meta_spend != null).length;

    if (rows.length > 0) {
      const { error: upsertError } = await upsertDailyPnl(supabase, rows);

      if (upsertError) {
        console.error('Upsert error:', upsertError);
        return NextResponse.json({ error: 'Failed to save data', details: upsertError.message }, { status: 500 });
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
          total_price: readShopifyAmount(o.total_price, o.total_price_set),
          subtotal_price: readShopifyAmount(o.subtotal_price, o.subtotal_price_set),
          total_tax: readShopifyAmount(o.total_tax, o.total_tax_set),
          total_discounts: readShopifyAmount(o.total_discounts, o.total_discounts_set),
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
      allProducts.push(...shopifyProductsFromPayload(firstProducts.data));
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
        allProducts.push(...shopifyProductsFromPayload(await res.json()));
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
          tags: shopifyProductTags(p.tags),
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
      const nativeSpend = await fetchDailyAdSpend(supabase, brand, spendFrom, spendTo);
      adSpendErrors.push(...nativeSpend.errors);
      const dailyGoogleNative = nativeSpend.google;
      const dailyMetaNative = nativeSpend.meta;

      const metaTokenForFx = process.env.META_ACCESS_TOKEN || '';
      let pipeboardTokenForFx = process.env.PIPEBOARD_API_TOKEN || '';
      if (!pipeboardTokenForFx) {
        const { data: pbSettings } = await supabase
          .from('app_settings')
          .select('value')
          .eq('key', 'pipeboard_api_token')
          .single();
        pipeboardTokenForFx = pbSettings?.value || '';
      }
      const [metaCurrency, googleCurrency, fxRates] = await Promise.all([
        fetchMetaAccountCurrency(brand.meta_ad_account_id, metaTokenForFx),
        fetchGoogleAccountCurrency(brand.google_ads_customer_id, pipeboardTokenForFx),
        getFxRates(),
      ]);
      const reporting = await resolveBrandReportingCurrency(
        supabase,
        brand,
        [],
        metaCurrency,
        googleCurrency
      );
      const dailyMeta = convertSpendMap(
        dailyMetaNative,
        metaCurrency || reporting.code,
        reporting.code,
        fxRates
      );
      const dailyGoogle = convertSpendMap(
        dailyGoogleNative,
        googleCurrency || reporting.code,
        reporting.code,
        fxRates
      );

      const adRows = buildSpendOnlyCoveredDayRows({
        brandId: brand.id,
        currency: reporting.code,
        syncedAt: new Date().toISOString(),
        coveredDays,
        meta: { ok: nativeSpend.metaOk, byDay: dailyMeta },
        google: { ok: nativeSpend.googleOk, byDay: dailyGoogle },
      });

      if (adRows.length > 0) {
        const { error: adErr } = await upsertDailyPnl(supabase, adRows);
        if (adErr) {
          adSpendErrors.push(`Ad spend upsert: ${adErr.message}`);
        } else {
          googleDaysSynced = adRows.filter((row) => row.google_spend != null).length;
          metaDaysSynced = adRows.filter((row) => row.meta_spend != null).length;
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
      date_range: { from: spendFrom, to: spendTo, timezone: timeZone },
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
              'Since Date': sinceDate ? ymdInTimeZone(new Date(sinceDate), timeZone) : '',
              'Until Date': untilDate ? ymdInTimeZone(new Date(untilDate), timeZone) : '',
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
