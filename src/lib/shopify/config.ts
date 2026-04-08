/**
 * Shopify app config — pulled from env so the same code works
 * locally, on preview deploys, and in production.
 */
export const SHOPIFY_CONFIG = {
  apiKey: process.env.SHOPIFY_API_KEY!,
  apiSecret: process.env.SHOPIFY_API_SECRET!,
  scopes: process.env.SHOPIFY_SCOPES!,
  appUrl: process.env.SHOPIFY_APP_URL || 'https://melch.cloud',
  apiVersion: '2026-04',
};

export function assertShopifyConfig() {
  const missing: string[] = [];
  if (!SHOPIFY_CONFIG.apiKey) missing.push('SHOPIFY_API_KEY');
  if (!SHOPIFY_CONFIG.apiSecret) missing.push('SHOPIFY_API_SECRET');
  if (!SHOPIFY_CONFIG.scopes) missing.push('SHOPIFY_SCOPES');
  if (missing.length) {
    throw new Error(`Missing Shopify env vars: ${missing.join(', ')}`);
  }
}

/**
 * Validates a `.myshopify.com` domain. Rejects anything that
 * isn't a real shop handle to prevent open-redirect / SSRF.
 */
export function isValidShopDomain(shop: string): boolean {
  return /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(shop);
}
