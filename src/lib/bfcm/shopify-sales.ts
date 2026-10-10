import type { PnlShopifyOrder } from '@/lib/shopify/pnl-days';
import { shopLocalDay } from '@/lib/shopify/shop-time';
import { zonedClock } from '@/lib/bfcm/calendar';

export interface HourSales {
  hour: number;
  revenue: number;
  orders: number;
  ncOrders: number;
  rcOrders: number;
  ncRevenue: number;
  rcRevenue: number;
}

export interface DaySales {
  revenue: number;
  orders: number;
  aov: number;
  ncOrders: number;
  rcOrders: number;
  ncRevenue: number;
  rcRevenue: number;
  hourly: HourSales[];
}

function emptyHour(hour: number): HourSales {
  return { hour, revenue: 0, orders: 0, ncOrders: 0, rcOrders: 0, ncRevenue: 0, rcRevenue: 0 };
}

export function emptyDaySales(): DaySales {
  return {
    revenue: 0,
    orders: 0,
    aov: 0,
    ncOrders: 0,
    rcOrders: 0,
    ncRevenue: 0,
    rcRevenue: 0,
    hourly: Array.from({ length: 24 }, (_, hour) => emptyHour(hour)),
  };
}

function grossOf(order: PnlShopifyOrder): number {
  return parseFloat(order.subtotal_price) + parseFloat(order.total_discounts);
}

/**
 * First-order ids for this order set.
 * Copied from aggregateOrdersByDay so the new-customer rule stays the same:
 * lifetime count when stamped, otherwise the embedded orders_count fallback.
 * Guests are not in this set; callers treat a missing customer as new.
 */
function firstOrderIds(orders: PnlShopifyOrder[]): Set<number> {
  const customerOrders = new Map<number, PnlShopifyOrder[]>();
  for (const order of orders) {
    if (order.financial_status === 'voided') continue;
    if (!order.customer) continue;
    const custId = order.customer.id;
    if (!customerOrders.has(custId)) customerOrders.set(custId, []);
    customerOrders.get(custId)!.push(order);
  }

  const ids = new Set<number>();
  for (const custOrds of Array.from(customerOrders.values())) {
    custOrds.sort((a: PnlShopifyOrder, b: PnlShopifyOrder) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    const enriched = custOrds[0];
    const lifetimeCount = enriched.lifetimeOrdersCount ?? 0;
    if (lifetimeCount > 0) {
      if (lifetimeCount <= custOrds.length) ids.add(custOrds[0].id);
    } else {
      const embeddedCount = custOrds[0].customer?.orders_count ?? 0;
      if (embeddedCount <= 1 || embeddedCount <= custOrds.length) ids.add(custOrds[0].id);
    }
  }
  return ids;
}

/**
 * Gross sales and new/returning split by shop-local day and hour.
 * Gross is subtotal + discounts, the Daily P&L gross. Voided orders are skipped.
 * Pass the same order set you would pass to aggregateOrdersByDay.
 */
export function salesByDay(orders: PnlShopifyOrder[], timeZone: string): Map<string, DaySales> {
  const ids = firstOrderIds(orders);
  const map = new Map<string, DaySales>();

  const ensure = (day: string): DaySales => {
    let bucket = map.get(day);
    if (!bucket) {
      bucket = emptyDaySales();
      map.set(day, bucket);
    }
    return bucket;
  };

  for (const order of orders) {
    if (order.financial_status === 'voided') continue;
    const parsed = new Date(order.created_at);
    if (Number.isNaN(parsed.getTime())) continue;
    const day = shopLocalDay(order.created_at, timeZone);
    const hour = zonedClock(parsed, timeZone).hour;
    if (hour < 0 || hour > 23) continue;
    const bucket = ensure(day);
    const gross = grossOf(order);
    const isNew = !order.customer || ids.has(order.id);
    bucket.revenue += gross;
    bucket.orders += 1;
    const slot = bucket.hourly[hour];
    slot.revenue += gross;
    slot.orders += 1;
    if (isNew) {
      bucket.ncOrders += 1;
      bucket.ncRevenue += gross;
      slot.ncOrders += 1;
      slot.ncRevenue += gross;
    } else {
      bucket.rcOrders += 1;
      bucket.rcRevenue += gross;
      slot.rcOrders += 1;
      slot.rcRevenue += gross;
    }
  }

  for (const bucket of Array.from(map.values())) {
    bucket.aov = bucket.orders > 0 ? bucket.revenue / bucket.orders : 0;
  }
  return map;
}

export function daySalesOrEmpty(map: Map<string, DaySales>, day: string): DaySales {
  return map.get(day) ?? emptyDaySales();
}

/** Mean of shop-local hours across the given days, including zero days. */
export function averageSalesByHour(days: DaySales[]): HourSales[] {
  const n = days.length;
  return Array.from({ length: 24 }, (_, hour) => {
    const sum = (pick: (slot: HourSales) => number) =>
      n === 0 ? 0 : days.reduce((total, day) => total + pick(day.hourly[hour]), 0) / n;
    return {
      hour,
      revenue: sum((slot) => slot.revenue),
      orders: sum((slot) => slot.orders),
      ncOrders: sum((slot) => slot.ncOrders),
      rcOrders: sum((slot) => slot.rcOrders),
      ncRevenue: sum((slot) => slot.ncRevenue),
      rcRevenue: sum((slot) => slot.rcRevenue),
    };
  });
}

/** Stored shopify_orders row → the order shape aggregateOrdersByDay already reads. */
export function storedOrder(row: Record<string, unknown>): PnlShopifyOrder | null {
  const raw = row.raw;
  if (raw && typeof raw === 'object' && typeof (raw as { created_at?: unknown }).created_at === 'string') {
    return raw as PnlShopifyOrder;
  }
  const createdAt = row.shopify_created_at;
  const id = Number(row.shopify_order_id);
  if (typeof createdAt !== 'string' || !Number.isFinite(id)) return null;
  const customerId = row.customer_id == null ? null : Number(row.customer_id);
  return {
    id,
    created_at: createdAt,
    financial_status: typeof row.financial_status === 'string' ? row.financial_status : 'paid',
    subtotal_price: String(row.subtotal_price ?? 0),
    total_discounts: String(row.total_discounts ?? 0),
    total_tax: String(row.total_tax ?? 0),
    shipping_lines: [],
    refunds: [],
    customer: customerId && Number.isFinite(customerId) ? { id: customerId, orders_count: 0 } : null,
  };
}
