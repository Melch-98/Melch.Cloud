import type { PnlShopifyOrder } from '@/lib/shopify/pnl-days';
import { alignLastYear, type BfcmDay } from '@/lib/bfcm/calendar';
import { daySalesOrEmpty, salesByDay, type DaySales } from '@/lib/bfcm/shopify-sales';

export interface PnlDaySnapshot {
  date: string;
  gross: number;
  orders: number;
  ncOrders: number;
  rcOrders: number;
  ncRevenue: number;
  rcRevenue: number;
}

export interface ShopifyActual {
  gross: number;
  orders: number;
  ncOrders: number | null;
  rcOrders: number | null;
  ncRevenue: number | null;
  rcRevenue: number | null;
  source: 'shopify_orders' | 'daily_pnl';
}

export interface ShopifyWindowDay {
  date: string;
  dayLabel: string;
  alignedDate: string;
  /** Null until that shop-local day has started. */
  actual: ShopifyActual | null;
  lastYear: ShopifyActual | 'no data';
}

export interface ShopifyWindow {
  connected: boolean;
  customerSplit: boolean;
  days: ShopifyWindowDay[];
}

/**
 * Last year is missing when that shop-local range has neither shopify_orders
 * nor a daily_pnl row. An earlier stray order does not cover the range.
 */
export function lastYearCoverageStatus(input: {
  orderCount: number;
  pnlRowCount: number;
}): 'ok' | 'no_last_year_data' {
  if (input.orderCount > 0 || input.pnlRowCount > 0) return 'ok';
  return 'no_last_year_data';
}

function splitFrom(
  orders: DaySales | null,
  pnl: PnlDaySnapshot | null,
  customerSplit: boolean,
  trustOrderSplit: boolean
): Pick<ShopifyActual, 'ncOrders' | 'rcOrders' | 'ncRevenue' | 'rcRevenue'> {
  if (!customerSplit) {
    return { ncOrders: null, rcOrders: null, ncRevenue: null, rcRevenue: null };
  }
  if (pnl) {
    return {
      ncOrders: pnl.ncOrders,
      rcOrders: pnl.rcOrders,
      ncRevenue: pnl.ncRevenue,
      rcRevenue: pnl.rcRevenue,
    };
  }
  if (trustOrderSplit && orders) {
    return {
      ncOrders: orders.ncOrders,
      rcOrders: orders.rcOrders,
      ncRevenue: orders.ncRevenue,
      rcRevenue: orders.rcRevenue,
    };
  }
  return { ncOrders: null, rcOrders: null, ncRevenue: null, rcRevenue: null };
}

/**
 * Gross prefers shopify_orders (subtotal + discounts, voided skipped).
 * A daily_pnl row covers a day that has no stored orders.
 * Closed days take new vs returning from daily_pnl. Today's enriched orders
 * may carry the split when trustOrderSplit is set. A quiet this-year day is
 * zero. A last-year day with neither source is "no data".
 */
export function resolveShopifyDay(input: {
  orders: DaySales | null | undefined;
  pnl: PnlDaySnapshot | null | undefined;
  customerSplit: boolean;
  emptyIsZero: boolean;
  trustOrderSplit: boolean;
}): ShopifyActual | 'no data' {
  const orders = input.orders && input.orders.orders > 0 ? input.orders : null;
  const pnl = input.pnl ?? null;
  if (!orders && !pnl) {
    if (!input.emptyIsZero) return 'no data';
    return {
      gross: 0,
      orders: 0,
      source: 'shopify_orders',
      ...splitFrom(null, null, input.customerSplit, false),
    };
  }
  if (orders) {
    return {
      gross: orders.revenue,
      orders: orders.orders,
      source: 'shopify_orders',
      ...splitFrom(orders, pnl, input.customerSplit, input.trustOrderSplit),
    };
  }
  return {
    gross: pnl!.gross,
    orders: pnl!.orders,
    source: 'daily_pnl',
    ...splitFrom(null, pnl, input.customerSplit, false),
  };
}

function byDate(rows: PnlDaySnapshot[] | undefined): Map<string, PnlDaySnapshot> {
  const map = new Map<string, PnlDaySnapshot>();
  for (const row of rows || []) {
    if (row.date) map.set(row.date, row);
  }
  return map;
}

function salesMap(
  existing: Map<string, DaySales> | undefined,
  orders: PnlShopifyOrder[] | undefined,
  timeZone: string
): Map<string, DaySales> {
  if (existing) return existing;
  return salesByDay(orders || [], timeZone);
}

/**
 * One row per day of this year's BFCM window.
 * Today uses the live order bucket. Past days use shopify_orders, then daily_pnl.
 * Last year's aligned day is "no data" unless that date has orders or a P&L row.
 */
export function buildShopifyWindow(input: {
  windowDays: BfcmDay[];
  today: string;
  timeZone: string;
  thisYearOrders?: PnlShopifyOrder[];
  thisYearSales?: Map<string, DaySales>;
  todayOrders?: PnlShopifyOrder[];
  todaySales?: DaySales | null;
  lastYearOrders?: PnlShopifyOrder[];
  lastYearSales?: Map<string, DaySales>;
  thisYearPnl?: PnlDaySnapshot[];
  lastYearPnl?: PnlDaySnapshot[];
  connected: boolean;
  customerSplit: boolean;
}): ShopifyWindow {
  const customerSplit = input.connected && input.customerSplit;
  if (!input.connected) {
    return {
      connected: false,
      customerSplit: false,
      days: input.windowDays.map((day) => ({
        date: day.date,
        dayLabel: day.dayLabel,
        alignedDate: alignLastYear(day.date).date,
        actual: null,
        lastYear: 'no data',
      })),
    };
  }

  const thisYear = salesMap(input.thisYearSales, input.thisYearOrders, input.timeZone);
  const lastYear = salesMap(input.lastYearSales, input.lastYearOrders, input.timeZone);
  const todaySales =
    input.todaySales ?? daySalesOrEmpty(salesByDay(input.todayOrders || [], input.timeZone), input.today);
  const thisPnl = byDate(input.thisYearPnl);
  const lastPnl = byDate(input.lastYearPnl);

  const days = input.windowDays.map((day) => {
    const alignedDate = alignLastYear(day.date).date;
    let actual: ShopifyActual | null = null;
    if (day.date < input.today) {
      const resolved = resolveShopifyDay({
        orders: thisYear.get(day.date),
        pnl: thisPnl.get(day.date),
        customerSplit,
        emptyIsZero: true,
        trustOrderSplit: false,
      });
      actual = resolved === 'no data' ? null : resolved;
    } else if (day.date === input.today) {
      const resolved = resolveShopifyDay({
        orders: todaySales,
        pnl: null,
        customerSplit,
        emptyIsZero: true,
        trustOrderSplit: true,
      });
      actual = resolved === 'no data' ? null : resolved;
    }
    return {
      date: day.date,
      dayLabel: day.dayLabel,
      alignedDate,
      actual,
      lastYear: resolveShopifyDay({
        orders: lastYear.get(alignedDate),
        pnl: lastPnl.get(alignedDate),
        customerSplit,
        emptyIsZero: false,
        trustOrderSplit: false,
      }),
    };
  });

  return { connected: true, customerSplit, days };
}
