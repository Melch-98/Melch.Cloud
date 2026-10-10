import { classifyShopifyConnection, type ShopifyConnection } from '@/lib/shopify/brand-connection';
import { exchangeClientCredentials } from '@/lib/shopify/client-credentials';
import { isValidShopDomain, normalizeShopDomain } from '@/lib/shopify/config';

type SupabaseLike = { from: (table: string) => any };

export type OrderBrand = {
  id: string;
  shopify_store_domain?: string | null;
  shopify_client_id?: string | null;
  shopify_client_secret?: string | null;
};

export type ResolvedOrderConnection = {
  domain: string | null;
  token: string | null;
  connection: ShopifyConnection;
};

function liveOauthToken(accessToken: string | null | undefined, uninstalledAt: string | null | undefined): string | null {
  if (!accessToken || uninstalledAt) return null;
  if (accessToken === 'gadget-managed') return null;
  return accessToken;
}

/**
 * Same connection choice as the order sync: custom-app or live Admin token,
 * otherwise Triple Whale when the brand has a shop domain.
 */
export async function resolveOrderConnection(
  supabase: SupabaseLike,
  brand: OrderBrand
): Promise<ResolvedOrderConnection> {
  const domain = normalizeShopDomain(brand.shopify_store_domain);
  let storeToken: string | null = null;
  if (domain) {
    const { data: store } = await supabase
      .from('shopify_stores')
      .select('access_token, uninstalled_at, shop_domain')
      .eq('shop_domain', domain)
      .maybeSingle();
    const storeDomain = normalizeShopDomain(store?.shop_domain);
    if (storeDomain === domain) {
      storeToken = liveOauthToken(store?.access_token, store?.uninstalled_at);
    }
  }

  const hasClientCredentials = !!(brand.shopify_client_id && brand.shopify_client_secret && domain);
  const connection = classifyShopifyConnection({
    domain,
    hasClientCredentials,
    hasLiveAdminToken: !!storeToken,
  });

  if (connection !== 'shopify_admin' || !domain || !isValidShopDomain(domain)) {
    return { domain, token: null, connection };
  }

  if (storeToken) return { domain, token: storeToken, connection };
  try {
    const exchanged = await exchangeClientCredentials(
      domain,
      brand.shopify_client_id!,
      brand.shopify_client_secret!
    );
    return { domain, token: exchanged.accessToken, connection };
  } catch {
    return { domain, token: null, connection };
  }
}
