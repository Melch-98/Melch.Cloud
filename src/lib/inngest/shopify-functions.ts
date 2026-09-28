import { inngest } from './client';
import { createServiceClient } from '@/lib/supabase-server';
import { shopifyOrderToRow } from '@/lib/shopify/order-row';
import { resolveBrandIdForShop } from '@/lib/shopify/order-sync';

/**
 * Shopify order events → upsert into shopify_orders.
 *
 * One handler covers create + updated since the payload shape is identical
 * and we always upsert.
 */
const upsertOrder = async (shop: string, order: Record<string, unknown>) => {
  const supabase = createServiceClient();
  // Installed Melch.Cloud shops resolve through shopify_stores. Custom-app
  // brands (no install row) resolve through brands.shopify_store_domain.
  const brandId = await resolveBrandIdForShop(supabase, shop);
  const row = shopifyOrderToRow(shop, brandId, order);

  const { error } = await supabase
    .from('shopify_orders')
    .upsert(row, { onConflict: 'shop_domain,shopify_order_id' });

  if (error) throw new Error(`Failed to upsert order: ${error.message}`);
  return { upserted: (order as { id?: unknown }).id ?? null, brand_id: brandId };
};

export const handleOrderCreated = inngest.createFunction(
  { id: 'shopify-order-created', name: 'Shopify: Order Created', retries: 3 },
  { event: 'shopify/order.created' },
  async ({ event, step }) => {
    return step.run('upsert-order', () =>
      upsertOrder(event.data.shop_domain, event.data.order)
    );
  }
);

export const handleOrderUpdated = inngest.createFunction(
  { id: 'shopify-order-updated', name: 'Shopify: Order Updated', retries: 3 },
  { event: 'shopify/order.updated' },
  async ({ event, step }) => {
    return step.run('upsert-order', () =>
      upsertOrder(event.data.shop_domain, event.data.order)
    );
  }
);

export const handleOrderCancelled = inngest.createFunction(
  { id: 'shopify-order-cancelled', name: 'Shopify: Order Cancelled', retries: 3 },
  { event: 'shopify/order.cancelled' },
  async ({ event, step }) => {
    return step.run('upsert-order', () =>
      upsertOrder(event.data.shop_domain, event.data.order)
    );
  }
);

export const handleRefundCreated = inngest.createFunction(
  { id: 'shopify-refund-created', name: 'Shopify: Refund Created', retries: 3 },
  { event: 'shopify/refund.created' },
  async ({ event }) => {
    // Refund payloads are not a full order. orders/updated upserts the order
    // (including its refunds array) and is what custom-app registration subscribes
    // to. This handler stays a log until a refund row is actually persisted.
    console.log('[shopify-refund]', event.data.shop_domain, event.data.refund);
    return { ok: true };
  }
);

export const handleAppUninstalled = inngest.createFunction(
  { id: 'shopify-app-uninstalled', name: 'Shopify: App Uninstalled', retries: 1 },
  { event: 'shopify/app.uninstalled' },
  async ({ event }) => {
    const supabase = createServiceClient();
    const { error } = await supabase
      .from('shopify_stores')
      .update({ uninstalled_at: new Date().toISOString() })
      .eq('shop_domain', event.data.shop_domain);
    if (error) throw new Error(error.message);
    return { uninstalled: event.data.shop_domain };
  }
);

export const shopifyFunctions = [
  handleOrderCreated,
  handleOrderUpdated,
  handleOrderCancelled,
  handleRefundCreated,
  handleAppUninstalled,
];
