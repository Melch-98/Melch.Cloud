import { readShopifyAmount } from './rest-payload.ts';
import { shopLocalDay } from './shop-time.ts';

/**
 * Order shape Daily P&L aggregation reads. NC/RC classification is unchanged:
 * lifetime count when the caller stamped it, otherwise embedded orders_count.
 */
export interface PnlShopifyOrder {
  id: number;
  created_at: string;
  financial_status: string;
  subtotal_price: string | number;
  subtotal_price_set?: unknown;
  total_discounts: string | number;
  total_discounts_set?: unknown;
  total_tax: string | number;
  total_tax_set?: unknown;
  shipping_lines?: Array<{
    is_removed?: boolean;
    discounted_price_set?: { shop_money: { amount: string | number } };
    discounted_price?: string | number;
    price?: string | number;
  }>;
  refunds?: Array<{
    created_at: string;
    transactions?: Array<{ amount: string | number; amount_set?: unknown; kind: string }>;
  }>;
  customer: { id: number; orders_count: number } | null;
  lifetimeOrdersCount?: number;
}

export interface DayBucket {
  nc_orders: number;
  nc_revenue: number;
  rc_orders: number;
  rc_revenue: number;
  gross_sales: number;
  discounts: number;
  refunds: number;
  taxes: number;
  shipping: number;
}

export function aggregateOrdersByDay(
  orders: PnlShopifyOrder[],
  timeZone: string
): Map<string, DayBucket> {
  const buckets = new Map<string, DayBucket>();

  const getOrCreate = (dateStr: string): DayBucket => {
    if (!buckets.has(dateStr)) {
      buckets.set(dateStr, {
        nc_orders: 0,
        nc_revenue: 0,
        rc_orders: 0,
        rc_revenue: 0,
        gross_sales: 0,
        discounts: 0,
        refunds: 0,
        taxes: 0,
        shipping: 0,
      });
    }
    return buckets.get(dateStr)!;
  };

  // ── NC/RC classification ──
  // An order is "new customer" iff it is that customer's FIRST order ever.
  // Previous logic marked the earliest order *within the sync window* as NC,
  // which mis-classified returning customers whose prior orders fell outside
  // the window. We now compare window-order-count vs customer.orders_count
  // (Shopify's lifetime count snapshot). If lifetime > window count, the
  // customer already had prior orders → ALL their window orders are RC.
  const customerOrders = new Map<number, PnlShopifyOrder[]>();
  const guestOrders: PnlShopifyOrder[] = [];

  for (const order of orders) {
    if (order.financial_status === 'voided') continue;
    if (!order.customer) {
      guestOrders.push(order); // No customer → treat as NC
    } else {
      const custId = order.customer.id;
      if (!customerOrders.has(custId)) customerOrders.set(custId, []);
      customerOrders.get(custId)!.push(order);
    }
  }

  // Build set of first-order IDs per customer. We rely on lifetimeOrdersCount
  // which is populated by the caller (fetched via /customers/{id}.json — the
  // embedded customer object on orders is unreliable for orders_count).
  const firstOrderIds = new Set<number>();
  for (const [, custOrds] of customerOrders) {
    custOrds.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    const enriched = custOrds[0];
    const lifetimeCount = enriched.lifetimeOrdersCount ?? 0;
    if (lifetimeCount > 0) {
      // Enrichment succeeded — use reliable lifetime count
      if (lifetimeCount <= custOrds.length) {
        firstOrderIds.add(custOrds[0].id);
      }
    } else {
      // Enrichment failed (lifetimeCount=0) — fall back to embedded orders_count
      const embeddedCount = custOrds[0].customer?.orders_count ?? 0;
      if (embeddedCount <= 1 || embeddedCount <= custOrds.length) {
        firstOrderIds.add(custOrds[0].id);
      }
    }
  }

  // Process all non-voided orders
  const allOrders = [...guestOrders];
  for (const [, custOrds] of customerOrders) allOrders.push(...custOrds);

  for (const order of allOrders) {
    const dateStr = shopLocalDay(order.created_at, timeZone);
    const bucket = getOrCreate(dateStr);

    const subtotal = readShopifyAmount(order.subtotal_price, order.subtotal_price_set) ?? 0;
    const totalDiscounts = readShopifyAmount(order.total_discounts, order.total_discounts_set) ?? 0;
    const grossSales = subtotal + totalDiscounts;
    const discounts = -Math.abs(totalDiscounts);
    const taxes = readShopifyAmount(order.total_tax, order.total_tax_set) ?? 0;
    // Post-discount shipping the customer paid. 2024-04 and later keep removed
    // shipping lines on the order and mark them is_removed; 2024-01 omitted them.
    const shipping = (order.shipping_lines || []).reduce((sum: number, line) => {
      if (line.is_removed) return sum;
      const amount =
        readShopifyAmount(line.discounted_price_set?.shop_money?.amount) ??
        readShopifyAmount(line.discounted_price) ??
        readShopifyAmount(line.price) ??
        0;
      return sum + amount;
    }, 0);

    // NC = guest order OR first order for this customer
    const isNewCustomer = !order.customer || firstOrderIds.has(order.id);

    // Use grossSales (subtotal + discounts) for NC/RC revenue so the proportional
    // split in calcFields reconciles with the grossSales total
    if (isNewCustomer) {
      bucket.nc_orders += 1;
      bucket.nc_revenue += grossSales;
    } else {
      bucket.rc_orders += 1;
      bucket.rc_revenue += grossSales;
    }

    bucket.gross_sales += grossSales;
    bucket.discounts += discounts;
    bucket.taxes += taxes;
    bucket.shipping += shipping;

    // Process refunds — attribute to the shop-local day the refund was created
    for (const refund of order.refunds || []) {
      const refundDate = shopLocalDay(refund.created_at, timeZone);
      const refundBucket = getOrCreate(refundDate);

      let refundAmount = 0;
      for (const txn of refund.transactions || []) {
        if (txn.kind === 'refund') {
          refundAmount += readShopifyAmount(txn.amount, txn.amount_set) ?? 0;
        }
      }
      refundBucket.refunds -= Math.abs(refundAmount);
    }
  }

  return buckets;
}
