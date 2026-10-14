import { shopifyOrderToRow } from './order-row';
import { resolveBrandIdForShop } from './order-sync';

type SupabaseLike = { from: (table: string) => any };

const ORDER_TOPICS = new Set(['orders/create', 'orders/updated', 'orders/cancelled']);

/**
 * Upserts one Shopify order webhook onto shopify_orders.
 * Conflict target is the order id within a shop, so a later create, update,
 * or cancel for the same order replaces that row.
 */
export async function upsertShopifyWebhookOrder(
  supabase: SupabaseLike,
  shop: string,
  order: Record<string, unknown>
) {
  const brandId = await resolveBrandIdForShop(supabase, shop);
  const row = shopifyOrderToRow(shop, brandId, order);

  const { error } = await supabase
    .from('shopify_orders')
    .upsert(row, { onConflict: 'shop_domain,shopify_order_id' });

  if (error) throw new Error(`Failed to upsert order: ${error.message}`);
  return { upserted: (order as { id?: unknown }).id ?? null, brand_id: brandId };
}

/**
 * One write to shopify_stores. A missing service client is a config error,
 * not a method call on null.
 */
export async function markShopifyAppUninstalled(supabase: SupabaseLike | null, shop: string) {
  if (!supabase) {
    throw new Error('Server config error: missing Supabase credentials');
  }
  const { error } = await supabase
    .from('shopify_stores')
    .update({ uninstalled_at: new Date().toISOString() })
    .eq('shop_domain', shop);
  if (error) throw new Error(error.message);
  return { uninstalled: shop };
}

/**
 * Handles a verified Shopify webhook payload. Order topics share one upsert.
 * refunds/create only logs: orders/updated already stores refunds on raw.
 */
export async function dispatchShopifyWebhook(args: {
  supabase: SupabaseLike | null;
  topic: string;
  shop: string;
  payload: Record<string, unknown>;
}) {
  const { supabase, topic, shop, payload } = args;

  if (ORDER_TOPICS.has(topic)) {
    if (!supabase) {
      throw new Error('Server config error: missing Supabase credentials');
    }
    return upsertShopifyWebhookOrder(supabase, shop, payload);
  }

  if (topic === 'refunds/create') {
    console.log('[shopify-refund]', shop, payload);
    return { ok: true as const };
  }

  if (topic === 'app/uninstalled') {
    return markShopifyAppUninstalled(supabase, shop);
  }

  if (topic === 'customers/data_request' || topic === 'customers/redact' || topic === 'shop/redact') {
    console.log(`[shopify-gdpr] ${topic} from ${shop}`, payload);
    return { ok: true as const };
  }

  console.warn(`[shopify-webhook] unhandled topic: ${topic}`);
  return { ok: true as const };
}
