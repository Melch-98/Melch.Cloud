export type TripleWhaleOrder = {
  order_id?: string | number | null;
  customer_id?: string | number | null;
  order_revenue?: number | null;
  gross_sales?: number | null;
  taxes?: number | null;
  discount_amount?: number | null;
  processed_at?: string | null;
  event_date?: string | null;
};

const round2 = (val: number) => Math.round(val * 100) / 100;

/**
 * Same shopify_orders shape as the manual Triple Whale sync.
 * Triple Whale's orders_table has no shipping address, email, or updated_at.
 */
export function tripleWhaleOrderRows(
  shopDomain: string,
  brandId: string,
  orders: TripleWhaleOrder[]
) {
  const updatedAt = new Date().toISOString();
  return orders
    .filter((order) => order.order_id != null && !Number.isNaN(Number(order.order_id)))
    .map((order) => ({
      shop_domain: shopDomain,
      brand_id: brandId,
      shopify_order_id: Number(order.order_id),
      customer_id: order.customer_id != null && order.customer_id !== '' ? Number(order.customer_id) : null,
      email: null,
      total_price: round2(order.order_revenue || 0),
      subtotal_price: round2(order.gross_sales || 0),
      total_tax: round2(order.taxes || 0),
      total_discounts: round2(order.discount_amount || 0),
      financial_status: 'paid',
      shopify_created_at: order.processed_at || `${order.event_date}T00:00:00.000Z`,
      source_name: 'triplewhale-sync',
      updated_at: updatedAt,
    }));
}

export async function fetchTripleWhaleOrders(
  apiKey: string,
  shopId: string,
  startDate: string,
  endDate: string
): Promise<TripleWhaleOrder[]> {
  const res = await fetch('https://api.triplewhale.com/api/v2/orcabase/api/sql', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      shopId,
      query: `SELECT event_date, order_id, customer_id, order_revenue, gross_sales, taxes, discount_amount, is_new_customer, processed_at, platform
         FROM orders_table
         WHERE event_date BETWEEN @startDate AND @endDate AND platform = 'shopify'`,
      currency: 'USD',
      period: { startDate, endDate },
    }),
  });

  if (res.status === 429) {
    const retryAfter = res.headers.get('Retry-After') || '60';
    throw new Error(`Triple Whale rate limited. Retry after ${retryAfter}s`);
  }
  if (res.status === 403) {
    throw new Error('Triple Whale API key is invalid or expired');
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Triple Whale API ${res.status}: ${body.slice(0, 300)}`);
  }

  const json = await res.json();
  if (Array.isArray(json)) return json as TripleWhaleOrder[];
  if (json && typeof json === 'object' && 'error' in json && json.error) {
    throw new Error(`Triple Whale query failed: ${String(json.error)}`);
  }
  const data = (json as { data?: TripleWhaleOrder[] })?.data;
  return Array.isArray(data) ? data : [];
}
