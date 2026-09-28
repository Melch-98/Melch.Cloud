import { createServiceClient } from '@/lib/supabase-server';
import { isValidShopDomain, normalizeShopDomain } from './config';

/**
 * Custom-app client secrets for a shop, matched on the myshopify domain.
 * Throws when Supabase cannot answer so callers can retry instead of
 * treating an outage as an invalid signature.
 */
export async function loadBrandClientSecrets(shopDomain: string): Promise<string[]> {
  const domain = normalizeShopDomain(shopDomain);
  if (!domain || !isValidShopDomain(domain)) return [];

  const supabase = createServiceClient();
  if (!supabase) throw new Error('Supabase is not configured');

  const handle = domain.replace(/\.myshopify\.com$/, '');
  const { data, error } = await supabase
    .from('brands')
    .select('shopify_store_domain, shopify_client_secret')
    .ilike('shopify_store_domain', `%${handle}.myshopify.com`)
    .not('shopify_client_secret', 'is', null);

  if (error) throw new Error(error.message);

  const secrets: string[] = [];
  for (const row of data || []) {
    if (normalizeShopDomain(row.shopify_store_domain) !== domain) continue;
    if (row.shopify_client_secret) secrets.push(row.shopify_client_secret);
  }
  return secrets;
}
