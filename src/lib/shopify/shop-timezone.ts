import { exchangeClientCredentials } from '@/lib/shopify/client-credentials';
import { normalizeShopDomain, SHOPIFY_CONFIG } from '@/lib/shopify/config';
import { isValidIanaTimeZone } from '@/lib/shopify/shop-time';

type SupabaseLike = { from: (table: string) => any };

export const SHOP_TIMEZONE_KEY_PREFIX = 'shop_iana_timezone:';

const memoryZone = new Map<string, string>();

export type ShopTimeZoneSource = 'memory' | 'app_settings' | 'shop_info' | 'shopify' | 'utc_fallback';

export type ResolvedShopTimeZone = {
  timeZone: string;
  source: ShopTimeZoneSource;
};

type BrandZoneInput = {
  id: string;
  name?: string | null;
  shopify_store_domain?: string | null;
  shopify_client_id?: string | null;
  shopify_client_secret?: string | null;
};

function zoneFromShopInfo(shopInfo: unknown): string | null {
  if (!shopInfo || typeof shopInfo !== 'object') return null;
  const info = shopInfo as Record<string, unknown>;
  const raw = info.iana_timezone ?? info.ianaTimezone ?? info.timezone;
  return typeof raw === 'string' && isValidIanaTimeZone(raw) ? raw : null;
}

async function readCachedZone(supabase: SupabaseLike, brandId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', `${SHOP_TIMEZONE_KEY_PREFIX}${brandId}`)
    .maybeSingle();
  if (error || typeof data?.value !== 'string') return null;
  return isValidIanaTimeZone(data.value) ? data.value : null;
}

async function writeCachedZone(supabase: SupabaseLike, brandId: string, timeZone: string): Promise<void> {
  const { error } = await supabase.from('app_settings').upsert(
    {
      key: `${SHOP_TIMEZONE_KEY_PREFIX}${brandId}`,
      value: timeZone,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'key' }
  );
  if (error) console.error(`Failed to cache shop timezone for ${brandId}: ${error.message}`);
}

async function readShopInfoZone(
  supabase: SupabaseLike,
  domain: string | null
): Promise<string | null> {
  if (!domain) return null;
  const { data, error } = await supabase
    .from('shopify_stores')
    .select('shop_info')
    .eq('shop_domain', domain)
    .maybeSingle();
  if (error) return null;
  return zoneFromShopInfo(data?.shop_info);
}

/** Same shop.json read Geo Performance uses. */
export async function fetchShopIanaTimeZone(domain: string, token: string): Promise<string | null> {
  const res = await fetch(`https://${domain}/admin/api/${SHOPIFY_CONFIG.apiVersion}/shop.json?fields=iana_timezone`, {
    headers: { 'X-Shopify-Access-Token': token },
  });
  if (!res.ok) return null;
  const body = await res.json();
  const tz = body?.shop?.iana_timezone;
  return typeof tz === 'string' && isValidIanaTimeZone(tz) ? tz : null;
}

/**
 * Shop IANA zone for Daily P&L day buckets.
 * Memory, then app_settings, then shopify_stores.shop_info, then shop.json.
 * A miss falls back to UTC and is not cached, so a later successful read can stick.
 */
export async function resolveShopIanaTimeZone(
  supabase: SupabaseLike,
  brand: BrandZoneInput,
  accessToken?: string | null
): Promise<ResolvedShopTimeZone> {
  const remembered = memoryZone.get(brand.id);
  if (remembered) return { timeZone: remembered, source: 'memory' };

  const cached = await readCachedZone(supabase, brand.id);
  if (cached) {
    memoryZone.set(brand.id, cached);
    return { timeZone: cached, source: 'app_settings' };
  }

  const domain = normalizeShopDomain(brand.shopify_store_domain);
  const fromShopInfo = await readShopInfoZone(supabase, domain);
  if (fromShopInfo) {
    memoryZone.set(brand.id, fromShopInfo);
    await writeCachedZone(supabase, brand.id, fromShopInfo);
    return { timeZone: fromShopInfo, source: 'shop_info' };
  }

  let token = accessToken || null;
  if (!token && domain && brand.shopify_client_id && brand.shopify_client_secret) {
    try {
      const exchanged = await exchangeClientCredentials(
        domain,
        brand.shopify_client_id,
        brand.shopify_client_secret
      );
      token = exchanged.accessToken;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Shopify token exchange failed';
      console.warn(`Shop timezone token failed for ${brand.name || brand.id}: ${message}`);
    }
  }

  if (domain && token) {
    try {
      const fetched = await fetchShopIanaTimeZone(domain, token);
      if (fetched) {
        memoryZone.set(brand.id, fetched);
        await writeCachedZone(supabase, brand.id, fetched);
        return { timeZone: fetched, source: 'shopify' };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Shop timezone lookup failed';
      console.warn(`Shop timezone lookup failed for ${brand.name || brand.id}: ${message}`);
    }
  }

  console.warn(`Shop timezone unavailable for ${brand.name || brand.id}; Daily P&L window uses UTC.`);
  return { timeZone: 'UTC', source: 'utc_fallback' };
}
