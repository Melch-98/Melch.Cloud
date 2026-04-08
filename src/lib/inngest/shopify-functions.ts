import { inngest } from './client';
import { createServiceClient } from '@/lib/supabase-server';

/**
 * Shopify order events → upsert into shopify_orders.
 *
 * One handler covers create + updated since the payload shape is identical
 * and we always upsert.
 */
const upsertOrder = async (shop: string, order: Record<string, unknown>) => {
  const supabase = createServiceClient();

  // Look up the brand_id for this shop (if installed).
  const { data: store } = await supabase
    .from('shopify_stores')
    .select('brand_id')
    .eq('shop_domain', shop)
    .maybeSingle();

  const o = order as any;

  const row = {
    shop_domain: shop,
    brand_id: store?.brand_id ?? null,
    shopify_order_id: o.id,
    order_number: o.name ?? o.order_number?.toString(),
    email: o.email,
    total_price: o.total_price ? Number(o.total_price) : null,
    subtotal_price: o.subtotal_price ? Number(o.subtotal_price) : null,
    total_tax: o.total_tax ? Number(o.total_tax) : null,
    total_discounts: o.total_discounts ? Number(o.total_discounts) : null,
    currency: o.currency,
    financial_status: o.financial_status,
    fulfillment_status: o.fulfillment_status,
    customer_id: o.customer?.id ?? null,
    line_items: o.line_items ?? null,
    shipping_address: o.shipping_address ?? null,
    billing_address: o.billing_address ?? null,
    source_name: o.source_name,
    landing_site: o.landing_site,
    referring_site: o.referring_site,
    shopify_created_at: o.created_at,
    shopify_updated_at: o.updated_at,
    raw: order,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from('shopify_orders')
    .upsert(row, { onConflict: 'shop_domain,shopify_order_id' });

  if (error) throw new Error(`Failed to upsert order: ${error.message}`);
  return { upserted: o.id };
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
    // Refund payloads include order_id — we just log for now and re-fetch later.
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
