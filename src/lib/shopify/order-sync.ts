import { logGrantedScopeHandles } from './access-scopes';
import { classifyShopifyConnection } from './brand-connection';
import { clearCatchUpCursor, loadCatchUpCursors, saveCatchUpCursor } from './catchup-cursor';
import { exchangeClientCredentials } from './client-credentials';
import { isValidShopDomain, normalizeShopDomain, SHOPIFY_CONFIG } from './config';
import { shopifyOrderToRow } from './order-row';
import { orderCatchUpPlan, type OrderCatchUpPlan } from './order-window';
import { fetchTripleWhaleOrders, tripleWhaleOrderRows } from './triple-whale-orders';

const ORDER_CURSOR_PREFIX = 'shopify_order_catchup:';

const PAGE_CAP = 80;
const UPSERT_CHUNK = 200;

type SupabaseLike = { from: (table: string) => any };

export type BrandSyncResult = {
  brand_id: string;
  name: string;
  shop_domain: string | null;
  since: string | null;
  fetched: number;
  upserted: number;
  truncated: boolean;
  warning: string | null;
  error: string | null;
  deferred: boolean;
  source: 'shopify_admin' | 'triple_whale' | null;
};

type BrandRow = {
  id: string;
  name: string;
  shopify_store_domain: string | null;
  shopify_client_id: string | null;
  shopify_client_secret: string | null;
};

type StoreRow = {
  brand_id: string | null;
  shop_domain: string;
  access_token: string | null;
  uninstalled_at: string | null;
};

function liveOauthToken(store: StoreRow | undefined): string | null {
  if (!store?.access_token) return null;
  if (store.uninstalled_at) return null;
  if (store.access_token === 'gadget-managed') return null;
  return store.access_token;
}

async function newestCreatedAt(
  supabase: SupabaseLike,
  domain: string
): Promise<string | null> {
  const { data, error } = await supabase
    .from('shopify_orders')
    .select('shopify_created_at')
    .eq('shop_domain', domain)
    .not('shopify_created_at', 'is', null)
    .order('shopify_created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data?.shopify_created_at as string | undefined) ?? null;
}

function latestCreatedAt(orders: Record<string, unknown>[]): string | null {
  let max = -Infinity;
  let iso: string | null = null;
  for (const order of orders) {
    if (typeof order.created_at !== 'string') continue;
    const ms = Date.parse(order.created_at);
    if (Number.isFinite(ms) && ms > max) {
      max = ms;
      iso = new Date(ms).toISOString();
    }
  }
  return iso;
}

/** Scope handles for one Shopify Admin brand. Token and secret stay out of the log. */
async function logBrandScopes(
  brand: BrandRow,
  token: string | null,
  domain: string | null
): Promise<void> {
  if (!domain || !isValidShopDomain(domain)) return;
  try {
    const accessToken =
      token ||
      (brand.shopify_client_id && brand.shopify_client_secret
        ? (
            await exchangeClientCredentials(
              domain,
              brand.shopify_client_id,
              brand.shopify_client_secret
            )
          ).accessToken
        : null);
    if (!accessToken) return;
    await logGrantedScopeHandles(brand.name, domain, accessToken);
  } catch (err) {
    let message = err instanceof Error ? err.message : 'Shopify access scopes failed';
    if (brand.shopify_client_secret) message = message.split(brand.shopify_client_secret).join('[redacted]');
    if (token) message = message.split(token).join('[redacted]');
    console.warn(`Shopify granted scopes lookup failed for ${brand.name} (${domain}): ${message}`);
  }
}

async function rememberOrderCursor(
  supabase: SupabaseLike,
  brandId: string,
  plan: OrderCatchUpPlan,
  orders: Record<string, unknown>[],
  truncated: boolean
): Promise<void> {
  if (!plan.chunked) {
    await clearCatchUpCursor(supabase, ORDER_CURSOR_PREFIX, brandId);
    return;
  }
  if (truncated) {
    const advanced = latestCreatedAt(orders);
    if (advanced) await saveCatchUpCursor(supabase, ORDER_CURSOR_PREFIX, brandId, advanced);
    return;
  }
  if (plan.until) await saveCatchUpCursor(supabase, ORDER_CURSOR_PREFIX, brandId, plan.until);
}

async function fetchOrdersUpdatedSince(
  domain: string,
  token: string,
  plan: OrderCatchUpPlan
): Promise<{ orders: Record<string, unknown>[]; truncated: boolean }> {
  const orders: Record<string, unknown>[] = [];
  const params = new URLSearchParams({ status: 'any', limit: '250' });
  if (plan.until) {
    params.set('created_at_min', plan.since);
    params.set('created_at_max', plan.until);
    params.set('order', 'created_at asc');
  } else {
    params.set('updated_at_min', plan.since);
  }
  const firstUrl =
    `https://${domain}/admin/api/${SHOPIFY_CONFIG.apiVersion}/orders.json?${params.toString()}`;
  let nextUrl: string | null = firstUrl;

  for (let page = 0; page < PAGE_CAP && nextUrl; page++) {
    const res: Response = await fetch(nextUrl, {
      headers: {
        'X-Shopify-Access-Token': token,
        'Content-Type': 'application/json',
      },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Shopify order fetch failed (${res.status}): ${body.slice(0, 300)}`);
    }
    const json = (await res.json()) as { orders?: Record<string, unknown>[] };
    const batch = Array.isArray(json.orders) ? json.orders : [];
    orders.push(...batch);
    const link = res.headers.get('Link') || '';
    const next = link.match(/<([^>]+)>;\s*rel="next"/);
    nextUrl = next ? next[1] : null;
    if (!nextUrl || batch.length < 250) {
      return { orders, truncated: false };
    }
    if (page === PAGE_CAP - 1) {
      return { orders, truncated: true };
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  return { orders, truncated: false };
}

export async function upsertShopifyOrders(
  supabase: SupabaseLike,
  domain: string,
  brandId: string,
  orders: Record<string, unknown>[]
): Promise<number> {
  let upserted = 0;
  for (let i = 0; i < orders.length; i += UPSERT_CHUNK) {
    const rows = orders.slice(i, i + UPSERT_CHUNK).map((order) =>
      shopifyOrderToRow(domain, brandId, order)
    );
    const { error } = await supabase
      .from('shopify_orders')
      .upsert(rows, { onConflict: 'shop_domain,shopify_order_id' });
    if (error) throw new Error(error.message);
    upserted += rows.length;
  }
  return upserted;
}

async function syncBrand(
  supabase: SupabaseLike,
  brand: BrandRow,
  store: StoreRow | undefined,
  resumeIso: string | null
): Promise<BrandSyncResult> {
  const base: BrandSyncResult = {
    brand_id: brand.id,
    name: brand.name,
    shop_domain: null,
    since: null,
    fetched: 0,
    upserted: 0,
    truncated: false,
    warning: null,
    error: null,
    deferred: false,
    source: null,
  };

  const brandDomain = normalizeShopDomain(brand.shopify_store_domain);
  const storeDomain = normalizeShopDomain(store?.shop_domain);
  const clientReady = !!(brand.shopify_client_id && brand.shopify_client_secret && brandDomain);
  // Prefer the brand's own shop. Use the installed-app token only when it is
  // for that same domain, or when the brand has no custom-app credentials.
  const domain = clientReady ? brandDomain : storeDomain;
  const oauth =
    domain && storeDomain === domain ? liveOauthToken(store) : null;
  if (!domain || !isValidShopDomain(domain) || (!oauth && !clientReady)) {
    return base;
  }
  base.shop_domain = domain;
  base.source = 'shopify_admin';

  let scopeToken: string | null = oauth;

  const pull = async (token: string) => {
    const newest = await newestCreatedAt(supabase, domain);
    const plan = orderCatchUpPlan(newest, Date.now(), resumeIso);
    base.since = plan.since;
    const { orders, truncated } = await fetchOrdersUpdatedSince(domain, token, plan);
    base.fetched = orders.length;
    base.truncated = truncated;
    base.upserted = await upsertShopifyOrders(supabase, domain, brand.id, orders);
    await rememberOrderCursor(supabase, brand.id, plan, orders, truncated);
    if (truncated) {
      base.warning = plan.chunked
        ? `Stopped after ${PAGE_CAP} pages (${orders.length} orders). Oldest orders in this chunk were stored; the next run continues.`
        : `Stopped after ${PAGE_CAP} pages (${orders.length} orders). Newer orders in the window were stored; a full shopify-sync is required for anything older that did not fit.`;
    } else if (plan.chunked) {
      base.warning = `Caught up through ${plan.until}. The next run continues.`;
    }
  };

  try {
    if (!scopeToken) {
      scopeToken = (
        await exchangeClientCredentials(
          domain,
          brand.shopify_client_id!,
          brand.shopify_client_secret!
        )
      ).accessToken;
    }
    try {
      await pull(scopeToken);
    } catch (err) {
      // A stale install token should not block a brand that also has custom-app credentials.
      const shopifyRejected = err instanceof Error && err.message.startsWith('Shopify ');
      if (!oauth || !clientReady || !shopifyRejected) throw err;
      scopeToken = (
        await exchangeClientCredentials(
          domain,
          brand.shopify_client_id!,
          brand.shopify_client_secret!
        )
      ).accessToken;
      await pull(scopeToken);
    }
    return base;
  } catch (err) {
    base.error = err instanceof Error ? err.message : 'Order sync failed';
    return base;
  } finally {
    if (scopeToken) await logGrantedScopeHandles(brand.name, domain, scopeToken);
  }
}

async function syncTripleWhaleBrand(
  supabase: SupabaseLike,
  brand: BrandRow,
  domain: string,
  resumeIso: string | null
): Promise<BrandSyncResult> {
  const base: BrandSyncResult = {
    brand_id: brand.id,
    name: brand.name,
    shop_domain: domain,
    since: null,
    fetched: 0,
    upserted: 0,
    truncated: false,
    warning: null,
    error: null,
    deferred: false,
    source: 'triple_whale',
  };

  const apiKey = process.env.TRIPLEWHALE_API_KEY;
  if (!apiKey) {
    base.error = 'TRIPLEWHALE_API_KEY is not configured';
    return base;
  }

  try {
    const newest = await newestCreatedAt(supabase, domain);
    const plan = orderCatchUpPlan(newest, Date.now(), resumeIso);
    base.since = plan.since;
    const startDate = plan.since.slice(0, 10);
    const endDate = (plan.until ?? new Date().toISOString()).slice(0, 10);
    const orders = await fetchTripleWhaleOrders(apiKey, domain, startDate, endDate);
    const rows = tripleWhaleOrderRows(domain, brand.id, orders);
    base.fetched = rows.length;
    for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
      const chunk = rows.slice(i, i + UPSERT_CHUNK);
      const { error } = await supabase
        .from('shopify_orders')
        .upsert(chunk, { onConflict: 'shop_domain,shopify_order_id' });
      if (error) throw new Error(error.message);
      base.upserted += chunk.length;
    }
    const stored = orders.map((order) => ({
      created_at: order.processed_at || (order.event_date ? `${order.event_date}T00:00:00.000Z` : null),
    }));
    await rememberOrderCursor(supabase, brand.id, plan, stored, false);
    if (plan.chunked) base.warning = `Caught up through ${plan.until}. The next run continues.`;
    return base;
  } catch (err) {
    base.error = err instanceof Error ? err.message : 'Triple Whale order sync failed';
    return base;
  }
}

/**
 * Pulls recent orders for every active brand that has a Shopify shop.
 * Custom-app credentials or a live install token use the Admin API.
 * A shop domain with neither (Organic Jaguar) uses Triple Whale, which is
 * the only credential that has ever written that brand's orders.
 */
export async function syncConnectedBrandOrders(
  supabase: SupabaseLike,
  deadlineMs?: number
): Promise<BrandSyncResult[]> {
  const { data: brands, error: brandError } = await supabase
    .from('brands')
    .select('id, name, shopify_store_domain, shopify_client_id, shopify_client_secret')
    .is('archived_at', null);
  if (brandError) throw new Error(brandError.message);

  const { data: stores, error: storeError } = await supabase
    .from('shopify_stores')
    .select('brand_id, shop_domain, access_token, uninstalled_at');
  if (storeError) throw new Error(storeError.message);

  const storeByBrand = new Map<string, StoreRow>();
  const storeByDomain = new Map<string, StoreRow>();
  for (const store of (stores || []) as StoreRow[]) {
    const domainKey = normalizeShopDomain(store.shop_domain);
    if (domainKey) storeByDomain.set(domainKey, store);
    if (store.brand_id && !storeByBrand.has(store.brand_id)) {
      storeByBrand.set(store.brand_id, store);
    }
  }

  const cursors = await loadCatchUpCursors(supabase, ORDER_CURSOR_PREFIX);
  const results: BrandSyncResult[] = [];
  for (const brand of (brands || []) as BrandRow[]) {
    const domain = normalizeShopDomain(brand.shopify_store_domain);
    const store =
      (domain && storeByDomain.get(domain)) || storeByBrand.get(brand.id);
    const storeDomain = normalizeShopDomain(store?.shop_domain);
    const tokenDomain = domain || storeDomain;
    const liveToken =
      tokenDomain && storeDomain === tokenDomain ? liveOauthToken(store) : null;
    const connection = classifyShopifyConnection({
      domain: tokenDomain,
      hasClientCredentials: !!(
        brand.shopify_client_id &&
        brand.shopify_client_secret &&
        domain
      ),
      hasLiveAdminToken: !!liveToken,
    });
    if (connection === 'none' || (connection === 'triple_whale' && !domain)) continue;
    if (deadlineMs !== undefined && Date.now() >= deadlineMs) {
      if (connection === 'shopify_admin') await logBrandScopes(brand, liveToken, tokenDomain);
      results.push({
        brand_id: brand.id,
        name: brand.name,
        shop_domain: domain,
        since: null,
        fetched: 0,
        upserted: 0,
        truncated: false,
        warning: 'Deferred so this run stays inside the 300s limit. The next run continues.',
        error: null,
        deferred: true,
        source: connection === 'triple_whale' ? 'triple_whale' : 'shopify_admin',
      });
      continue;
    }
    if (connection === 'shopify_admin') {
      results.push(await syncBrand(supabase, brand, store, cursors.get(brand.id) ?? null));
    } else if (connection === 'triple_whale' && domain) {
      results.push(await syncTripleWhaleBrand(supabase, brand, domain, cursors.get(brand.id) ?? null));
    }
    if (connection !== 'none') {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
  return results;
}

/**
 * shopify_stores.brand_id when the Melch app is installed, otherwise the
 * brand whose shopify_store_domain is this shop. Used by order webhooks.
 */
export async function resolveBrandIdForShop(
  supabase: SupabaseLike,
  shop: string
): Promise<string | null> {
  const domain = normalizeShopDomain(shop);
  if (!domain) return null;

  const { data: store, error: storeError } = await supabase
    .from('shopify_stores')
    .select('brand_id')
    .eq('shop_domain', domain)
    .maybeSingle();
  if (storeError) throw new Error(storeError.message);
  if (store?.brand_id) return store.brand_id as string;

  const handle = domain.replace(/\.myshopify\.com$/, '');
  const { data: brands, error: brandError } = await supabase
    .from('brands')
    .select('id, shopify_store_domain')
    .ilike('shopify_store_domain', `%${handle}.myshopify.com`)
    .limit(10);
  if (brandError) throw new Error(brandError.message);

  const matches = (brands || []).filter(
    (brand: { shopify_store_domain?: string | null }) =>
      normalizeShopDomain(brand.shopify_store_domain) === domain
  );
  if (matches.length > 1) {
    throw new Error(`Multiple brands share shop domain ${domain}`);
  }
  return matches[0]?.id ?? null;
}
