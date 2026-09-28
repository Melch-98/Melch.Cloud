/**
 * Maps a Shopify order payload onto a shopify_orders row.
 * Same shape the webhook upsert has always written.
 */
export function shopifyOrderToRow(
  shop: string,
  brandId: string | null,
  order: Record<string, unknown>
) {
  const o = order as {
    id?: number;
    name?: string;
    order_number?: number | string;
    email?: string | null;
    total_price?: string | number | null;
    subtotal_price?: string | number | null;
    total_tax?: string | number | null;
    total_discounts?: string | number | null;
    currency?: string | null;
    financial_status?: string | null;
    fulfillment_status?: string | null;
    customer?: { id?: number | null } | null;
    line_items?: unknown;
    shipping_address?: unknown;
    billing_address?: unknown;
    source_name?: string | null;
    landing_site?: string | null;
    referring_site?: string | null;
    created_at?: string | null;
    updated_at?: string | null;
  };

  const num = (value: string | number | null | undefined): number | null => {
    if (value == null || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };

  return {
    shop_domain: shop,
    brand_id: brandId,
    shopify_order_id: o.id,
    order_number: o.name ?? (o.order_number != null ? String(o.order_number) : undefined),
    email: o.email,
    total_price: num(o.total_price),
    subtotal_price: num(o.subtotal_price),
    total_tax: num(o.total_tax),
    total_discounts: num(o.total_discounts),
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
}
