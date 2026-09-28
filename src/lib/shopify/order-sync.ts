import { exchangeClientCredentials } from './client-credentials';
import { isValidShopDomain, normalizeShopDomain } from './config';
import { shopifyOrderToRow } from './order-row';
import { safetyNetSince } from './order-window';

/** Same Admin API version shopify-sync and Geo catch-up already call. */
const ORDERS_API_VERSION = '2024-01';
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

async function fetchOrdersUpdatedSince(
  domain: string,
  token: string,
  updatedMin: string
): Promise<{ orders: Record<string, unknown>[]; truncated: boolean }> {
  const orders: Record<string, unknown>[] = [];
  const firstUrl =
    `https://${domain}/admin/api/${ORDERS_API_VERSION}/orders.json` +
    `?status=any&limit=250&updated_at_min=${encodeURIComponent(updatedMin)}`;
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

async function upsertOrders(
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
  store: StoreRow | undefined
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

  const pull = async (token: string) => {
    const newest = await newestCreatedAt(supabase, domain);
    const since = safetyNetSince(newest, Date.now());
    base.since = since;
    const { orders, truncated } = await fetchOrdersUpdatedSince(domain, token, since);
    base.fetched = orders.length;
    base.truncated = truncated;
    base.upserted = await upsertOrders(supabase, domain, brand.id, orders);
    if (truncated) {
      base.warning = `Stopped after ${PAGE_CAP} pages (${orders.length} orders). Newer orders in the window were stored; a full shopify-sync is required for anything older that did not fit.`;
    }
  };

  try {
    const token = oauth
      ? oauth
      : (
          await exchangeClientCredentials(
            domain,
            brand.shopify_client_id!,
            brand.shopify_client_secret!
          )
        ).accessToken;
    try {
      await pull(token);
    } catch (err) {
      // A stale install token should not block a brand that also has custom-app credentials.
      const shopifyRejected = err instanceof Error && err.message.startsWith('Shopify ');
      if (!oauth || !clientReady || !shopifyRejected) throw err;
      const clientToken = (
        await exchangeClientCredentials(
          domain,
          brand.shopify_client_id!,
          brand.shopify_client_secret!
        )
      ).accessToken;
      await pull(clientToken);
    }
    return base;
  } catch (err) {
    base.error = err instanceof Error ? err.message : 'Order sync failed';
    return base;
  }
}

/**
 * Pulls recent Shopify orders for every connected brand into shopify_orders.
 * A brand is connected when it has a live Melch.Cloud install token or
 * custom-app client credentials plus a myshopify domain.
 */
export async function syncConnectedBrandOrders(supabase: SupabaseLike): Promise<BrandSyncResult[]> {
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

  const results: BrandSyncResult[] = [];
  for (const brand of (brands || []) as BrandRow[]) {
    const domain = normalizeShopDomain(brand.shopify_store_domain);
    const store =
      (domain && storeByDomain.get(domain)) || storeByBrand.get(brand.id);
    const connected =
      !!liveOauthToken(store) ||
      !!(brand.shopify_client_id && brand.shopify_client_secret && domain);
    if (!connected) continue;
    results.push(await syncBrand(supabase, brand, store));
    await new Promise((resolve) => setTimeout(resolve, 150));
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
