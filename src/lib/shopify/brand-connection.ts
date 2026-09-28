export type ShopifyConnection = 'shopify_admin' | 'triple_whale' | 'none';

/**
 * How a brand's orders can be collected.
 * Shopify Admin (custom-app credentials or a live install token) can register
 * webhooks. A shop domain with neither is the Triple Whale path: that API key
 * can pull orders, and it cannot sign Shopify webhooks.
 */
export function classifyShopifyConnection(input: {
  domain: string | null;
  hasClientCredentials: boolean;
  hasLiveAdminToken: boolean;
}): ShopifyConnection {
  if (input.domain && (input.hasClientCredentials || input.hasLiveAdminToken)) {
    return 'shopify_admin';
  }
  if (input.domain) return 'triple_whale';
  return 'none';
}
