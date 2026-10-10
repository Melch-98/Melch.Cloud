import type { PnlShopifyOrder } from '@/lib/shopify/pnl-days';
import { enrichCustomerOrderCounts } from '@/lib/shopify/run-shopify-brand-sync';
import { storedOrder } from '@/lib/bfcm/shopify-sales';

type SupabaseLike = { from: (table: string) => any };

const ORDER_COLUMNS =
  'shopify_order_id, shopify_created_at, subtotal_price, total_discounts, total_tax, financial_status, customer_id, raw, source_name';

const PAGE = 200;
const MAX_ROWS = 20_000;

export async function loadOrdersBetween(
  supabase: SupabaseLike,
  brandId: string,
  sinceIso: string,
  untilIso: string
): Promise<PnlShopifyOrder[]> {
  const orders: PnlShopifyOrder[] = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const { data, error } = await supabase
      .from('shopify_orders')
      .select(ORDER_COLUMNS)
      .eq('brand_id', brandId)
      .gte('shopify_created_at', sinceIso)
      .lte('shopify_created_at', untilIso)
      .order('shopify_order_id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (data || []) as Array<Record<string, unknown>>;
    for (const row of rows) {
      const order = storedOrder(row);
      if (order) orders.push(order);
    }
    if (rows.length < PAGE) break;
  }
  return orders;
}

export async function enrichOrders(
  domain: string | null,
  token: string | null,
  orders: PnlShopifyOrder[]
): Promise<void> {
  if (!domain || !token || orders.length === 0) return;
  await enrichCustomerOrderCounts(domain, token, orders);
}

export type OrderFreshnessRow = {
  newestAt: string | null;
  earliestAt: string | null;
};

export async function loadOrderFreshness(
  supabase: SupabaseLike,
  brandId: string
): Promise<OrderFreshnessRow> {
  const newest = supabase
    .from('shopify_orders')
    .select('shopify_created_at')
    .eq('brand_id', brandId)
    .not('shopify_created_at', 'is', null)
    .order('shopify_created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const earliest = supabase
    .from('shopify_orders')
    .select('shopify_created_at')
    .eq('brand_id', brandId)
    .not('shopify_created_at', 'is', null)
    .order('shopify_created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  const [newestRes, earliestRes] = await Promise.all([newest, earliest]);
  if (newestRes.error) throw new Error(newestRes.error.message);
  if (earliestRes.error) throw new Error(earliestRes.error.message);
  return {
    newestAt: (newestRes.data?.shopify_created_at as string | undefined) ?? null,
    earliestAt: (earliestRes.data?.shopify_created_at as string | undefined) ?? null,
  };
}
