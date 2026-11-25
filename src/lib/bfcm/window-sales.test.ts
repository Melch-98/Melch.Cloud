import { describe, expect, it } from 'vitest';
import { bfcmWindow } from '@/lib/bfcm/calendar';
import type { PnlShopifyOrder } from '@/lib/shopify/pnl-days';
import { buildShopifyWindow, lastYearCoverageStatus, resolveShopifyDay } from '@/lib/bfcm/window-sales';

function order(
  id: number,
  createdAt: string,
  subtotal: string,
  extra: Partial<PnlShopifyOrder> = {}
): PnlShopifyOrder {
  return {
    id,
    created_at: createdAt,
    financial_status: 'paid',
    subtotal_price: subtotal,
    total_discounts: '0',
    total_tax: '0',
    shipping_lines: [],
    refunds: [],
    customer: null,
    ...extra,
  };
}

describe('last year coverage', () => {
  it('is missing when the range has neither orders nor a daily_pnl row', () => {
    expect(lastYearCoverageStatus({ orderCount: 0, pnlRowCount: 0 })).toBe('no_last_year_data');
    expect(lastYearCoverageStatus({ orderCount: 1, pnlRowCount: 0 })).toBe('ok');
    expect(lastYearCoverageStatus({ orderCount: 0, pnlRowCount: 1 })).toBe('ok');
  });

  it('shows no data for FOND when only stray orders exist outside last year BFCM', () => {
    const window = bfcmWindow(2026);
    const built = buildShopifyWindow({
      windowDays: window.days,
      today: '2026-11-25',
      timeZone: 'America/Toronto',
      thisYearOrders: [],
      lastYearOrders: [
        order(1, '2020-06-01T15:00:00Z', '10.00'),
        order(2, '2021-01-04T15:00:00Z', '12.00'),
        order(3, '2025-10-27T15:00:00Z', '40.00'),
      ],
      connected: true,
      customerSplit: true,
    });
    expect(built.days.every((day) => day.lastYear === 'no data')).toBe(true);
    const blackFriday = built.days.find((day) => day.date === '2026-11-27');
    expect(blackFriday?.alignedDate).toBe('2025-11-28');
    expect(blackFriday?.actual).toBeNull();
  });

  it('keeps a real zero when daily_pnl has a row and ignores orders that are not in the range', () => {
    const window = bfcmWindow(2026);
    const built = buildShopifyWindow({
      windowDays: window.days,
      today: '2026-11-25',
      timeZone: 'America/Toronto',
      lastYearOrders: [order(9, '2025-10-27T15:00:00Z', '40.00')],
      lastYearPnl: [
        {
          date: '2025-11-28',
          gross: 0,
          orders: 0,
          ncOrders: 0,
          rcOrders: 0,
          ncRevenue: 0,
          rcRevenue: 0,
        },
      ],
      connected: true,
      customerSplit: true,
    });
    const blackFriday = built.days.find((day) => day.date === '2026-11-27');
    expect(blackFriday?.lastYear).toMatchObject({ gross: 0, source: 'daily_pnl' });
    const cyberMonday = built.days.find((day) => day.date === '2026-11-30');
    expect(cyberMonday?.lastYear).toBe('no data');
  });
});

describe('BFCM window day aggregation', () => {
  const window = bfcmWindow(2026);

  it('puts an order after 7pm CT on the previous shop day and drops a voided order', () => {
    const built = buildShopifyWindow({
      windowDays: window.days,
      today: '2026-11-27',
      timeZone: 'America/Chicago',
      thisYearOrders: [
        order(1, '2026-11-27T01:30:00Z', '50.00', { total_discounts: '5.00' }),
        order(2, '2026-11-27T01:40:00Z', '999.00', { financial_status: 'voided' }),
      ],
      todayOrders: [order(3, '2026-11-27T16:00:00Z', '20.00')],
      connected: true,
      customerSplit: true,
    });
    const thanksgiving = built.days.find((day) => day.date === '2026-11-26');
    const blackFriday = built.days.find((day) => day.date === '2026-11-27');
    expect(thanksgiving?.actual).toMatchObject({ gross: 55, orders: 1, source: 'shopify_orders' });
    expect(blackFriday?.actual).toMatchObject({ gross: 20, orders: 1 });
    expect(blackFriday?.actual?.ncOrders).toBe(1);
  });

  it('splits the same instant across Chicago and Toronto', () => {
    const instant = [order(1, '2026-11-27T05:30:00Z', '80.00')];
    const chicago = buildShopifyWindow({
      windowDays: window.days,
      today: '2026-11-27',
      timeZone: 'America/Chicago',
      thisYearOrders: instant,
      connected: true,
      customerSplit: true,
    });
    const toronto = buildShopifyWindow({
      windowDays: window.days,
      today: '2026-11-27',
      timeZone: 'America/Toronto',
      thisYearOrders: instant,
      todayOrders: instant,
      connected: true,
      customerSplit: true,
    });
    expect(chicago.days.find((day) => day.date === '2026-11-26')?.actual).toMatchObject({ gross: 80, orders: 1 });
    expect(chicago.days.find((day) => day.date === '2026-11-27')?.actual).toMatchObject({ gross: 0, orders: 0 });
    expect(toronto.days.find((day) => day.date === '2026-11-26')?.actual).toMatchObject({ gross: 0, orders: 0 });
    expect(toronto.days.find((day) => day.date === '2026-11-27')?.actual).toMatchObject({ gross: 80, orders: 1 });
  });

  it('uses daily_pnl for a closed day with no orders and leaves future days empty', () => {
    const built = buildShopifyWindow({
      windowDays: window.days,
      today: '2026-11-25',
      timeZone: 'America/New_York',
      thisYearPnl: [
        {
          date: '2026-11-24',
          gross: 140,
          orders: 4,
          ncOrders: 3,
          rcOrders: 1,
          ncRevenue: 100,
          rcRevenue: 40,
        },
      ],
      connected: true,
      customerSplit: true,
    });
    expect(built.days.find((day) => day.date === '2026-11-24')?.actual).toMatchObject({
      gross: 140,
      orders: 4,
      ncOrders: 3,
      rcOrders: 1,
      source: 'daily_pnl',
    });
    expect(built.days.find((day) => day.date === '2026-11-23')?.actual).toMatchObject({ gross: 0, orders: 0 });
    expect(built.days.find((day) => day.date === '2026-11-27')?.actual).toBeNull();
  });

  it('hides the new vs returning split and does not invent zeros when Shopify is not connected', () => {
    const whale = buildShopifyWindow({
      windowDays: window.days,
      today: '2026-11-25',
      timeZone: 'America/New_York',
      todaySales: {
        revenue: 90,
        orders: 2,
        aov: 45,
        ncOrders: 2,
        rcOrders: 0,
        ncRevenue: 90,
        rcRevenue: 0,
        hourly: [],
      },
      connected: true,
      customerSplit: false,
    });
    expect(whale.customerSplit).toBe(false);
    expect(whale.days.find((day) => day.date === '2026-11-25')?.actual).toMatchObject({
      gross: 90,
      orders: 2,
      ncOrders: null,
      rcOrders: null,
    });

    const none = buildShopifyWindow({
      windowDays: window.days,
      today: '2026-11-25',
      timeZone: 'America/New_York',
      thisYearOrders: [order(1, '2026-11-24T15:00:00Z', '500.00')],
      connected: false,
      customerSplit: true,
    });
    expect(none.connected).toBe(false);
    expect(none.days.every((day) => day.actual === null && day.lastYear === 'no data')).toBe(true);
  });

  it('does not count a voided-only last-year day as coverage', () => {
    const resolved = resolveShopifyDay({
      orders: null,
      pnl: null,
      customerSplit: true,
      emptyIsZero: false,
      trustOrderSplit: false,
    });
    expect(resolved).toBe('no data');
    const built = buildShopifyWindow({
      windowDays: window.days,
      today: '2026-11-27',
      timeZone: 'America/New_York',
      lastYearOrders: [order(4, '2025-11-28T16:00:00Z', '999.00', { financial_status: 'voided' })],
      connected: true,
      customerSplit: true,
    });
    expect(built.days.find((day) => day.date === '2026-11-27')?.lastYear).toBe('no data');
  });
});
