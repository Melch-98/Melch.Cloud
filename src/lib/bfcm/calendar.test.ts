import { describe, expect, it } from 'vitest';
import { aggregateOrdersByDay, type PnlShopifyOrder } from '@/lib/shopify/pnl-days';
import {
  alignLastYear,
  bfcmWindow,
  lastYearFigure,
  lastYearSalesStatus,
  lastYearTotal,
  orderFeed,
  shopDayRangeIso,
  shopTodayAndL7,
  zonedClock,
} from '@/lib/bfcm/calendar';
import { salesByDay } from '@/lib/bfcm/shopify-sales';

function order(id: number, createdAt: string, subtotal: string, customer: PnlShopifyOrder['customer'] = null): PnlShopifyOrder {
  return {
    id,
    created_at: createdAt,
    financial_status: 'paid',
    subtotal_price: subtotal,
    total_discounts: '0',
    total_tax: '0',
    shipping_lines: [],
    refunds: [],
    customer,
  };
}

describe('shop clock after 7pm CT', () => {
  // 00:30 UTC is 7:30pm CDT (UTC-5) the previous evening.
  const afterSevenCdt = new Date('2026-10-10T00:30:00Z');
  // 01:30 UTC on Nov 27 is 7:30pm CST (UTC-6) on Thanksgiving, after DST has ended.
  const afterSevenCst = new Date('2026-11-27T01:30:00Z');

  it('keeps Chicago, Toronto, and New York on the previous local date after 7pm CT', () => {
    for (const zone of ['America/Chicago', 'America/Toronto', 'America/New_York'] as const) {
      expect(zonedClock(afterSevenCdt, zone).ymd).toBe('2026-10-09');
      expect(shopTodayAndL7(afterSevenCdt, zone).today).toBe('2026-10-09');
    }
    expect(zonedClock(afterSevenCdt, 'America/Chicago').hour).toBe(19);
    expect(zonedClock(afterSevenCdt, 'America/Toronto').hour).toBe(20);
    expect(zonedClock(afterSevenCdt, 'America/New_York').hour).toBe(20);

    expect(zonedClock(afterSevenCst, 'America/Chicago')).toMatchObject({ ymd: '2026-11-26', hour: 19 });
    expect(zonedClock(afterSevenCst, 'America/Toronto')).toMatchObject({ ymd: '2026-11-26', hour: 20 });
    expect(zonedClock(afterSevenCst, 'America/New_York')).toMatchObject({ ymd: '2026-11-26', hour: 20 });
  });

  it('asks for the shop-local L7, not the UTC date that has already rolled', () => {
    const chicago = shopTodayAndL7(afterSevenCst, 'America/Chicago');
    expect(chicago.l7).toEqual([
      '2026-11-19',
      '2026-11-20',
      '2026-11-21',
      '2026-11-22',
      '2026-11-23',
      '2026-11-24',
      '2026-11-25',
    ]);
  });

  it('buckets an order placed after 7pm CT into that shop hour', () => {
    const chicago = salesByDay([order(1, '2026-11-27T01:30:00Z', '50.00')], 'America/Chicago');
    const day = chicago.get('2026-11-26');
    expect(day?.revenue).toBe(50);
    expect(day?.hourly[19].revenue).toBe(50);
    expect(day?.hourly[1].revenue).toBe(0);
    expect(chicago.has('2026-11-27')).toBe(false);

    const toronto = salesByDay([order(1, '2026-10-10T00:30:00Z', '40.00')], 'America/Toronto');
    expect(toronto.get('2026-10-09')?.hourly[20].revenue).toBe(40);

    const ny = salesByDay([order(1, '2026-10-10T00:30:00Z', '40.00')], 'America/New_York');
    expect(ny.get('2026-10-09')?.hourly[20].revenue).toBe(40);
  });
});

describe('BFCM event alignment', () => {
  it('uses the 2026 Monday-through-Cyber-Monday window', () => {
    const window = bfcmWindow(2026);
    expect(window.thanksgiving).toBe('2026-11-26');
    expect(window.blackFriday).toBe('2026-11-27');
    expect(window.cyberMonday).toBe('2026-11-30');
    expect(window.start).toBe('2026-11-23');
    expect(window.end).toBe('2026-11-30');
    expect(window.days).toHaveLength(8);
  });

  it('maps Black Friday and Cyber Monday onto last year, and other window days by offset', () => {
    expect(alignLastYear('2026-11-27')).toMatchObject({
      date: '2025-11-28',
      rule: 'bfcm_event',
      dayLabel: 'Black Friday',
      offsetFromBlackFriday: 0,
    });
    expect(alignLastYear('2026-11-30')).toMatchObject({
      date: '2025-12-01',
      rule: 'bfcm_event',
      dayLabel: 'Cyber Monday',
      offsetFromBlackFriday: 3,
    });
    expect(alignLastYear('2026-11-23')).toMatchObject({
      date: '2025-11-24',
      rule: 'bfcm_event',
      offsetFromBlackFriday: -4,
    });
    expect(alignLastYear('2026-11-26')).toMatchObject({
      date: '2025-11-27',
      dayLabel: 'Thanksgiving',
      offsetFromBlackFriday: -1,
    });
  });

  it('does not send an ordinary Friday to last year Black Friday', () => {
    const ordinaryFriday = alignLastYear('2026-11-20');
    expect(ordinaryFriday.rule).toBe('minus_364');
    expect(ordinaryFriday.date).toBe('2025-11-21');
    expect(ordinaryFriday.date).not.toBe('2025-11-28');
  });

  it('uses date minus 364 days outside the window', () => {
    expect(alignLastYear('2026-10-10')).toMatchObject({
      date: '2025-10-11',
      rule: 'minus_364',
      inWindow: false,
    });
  });

  it('treats history that starts after the comparison day as missing, not zero', () => {
    expect(lastYearSalesStatus('2025-11-28', '2026-06-28')).toBe('no_last_year_data');
    expect(lastYearSalesStatus('2025-11-28', '2026-03-11')).toBe('no_last_year_data');
    expect(lastYearSalesStatus('2025-11-28', null)).toBe('no_last_year_data');
    expect(lastYearSalesStatus('2025-11-28', '2025-11-01')).toBe('ok');
    expect(lastYearSalesStatus('2025-11-28', '2025-11-28')).toBe('ok');
  });

  it('shows no data for a zero day before the first stored order and keeps a real zero', () => {
    expect(lastYearFigure(0, '2025-11-28', '2026-06-28')).toBe('no data');
    expect(lastYearFigure(0, '2025-11-28', '2026-03-11')).toBe('no data');
    expect(lastYearFigure(0, '2025-11-28', null)).toBe('no data');
    expect(lastYearFigure(120, '2025-11-28', '2026-06-28')).toBe(120);
    expect(lastYearFigure(0, '2025-11-28', '2025-11-01')).toBe(0);
    expect(lastYearTotal(
      [
        { date: '2025-11-24', amount: 0 },
        { date: '2025-11-28', amount: 0 },
      ],
      '2026-06-28'
    )).toBe('no data');
    expect(lastYearTotal(
      [
        { date: '2025-11-27', amount: 0 },
        { date: '2025-11-28', amount: 40 },
      ],
      '2025-11-01'
    )).toBe(40);
  });
});

describe('shop day bounds', () => {
  it('starts a Toronto day at local midnight, not UTC midnight', () => {
    const range = shopDayRangeIso('2025-11-15', '2025-11-15', 'America/Toronto');
    expect(range.min).toBe('2025-11-15T05:00:00.000Z');
    expect(range.max.startsWith('2025-11-16T04:59:59')).toBe(true);
  });
});

describe('order feed label', () => {
  it('names real-time, the 2-hour cron, and Triple Whale', () => {
    expect(orderFeed({ connection: 'shopify_admin', webhooksOk: true }).feed).toBe('realtime');
    expect(orderFeed({ connection: 'shopify_admin', webhooksOk: false }).feed).toBe('cron_2h');
    expect(orderFeed({ connection: 'triple_whale', webhooksOk: false }).feed).toBe('triple_whale');
  });
});

describe('hourly sales match Daily P&L gross and new-customer totals', () => {
  it('sums to aggregateOrdersByDay for guests, lifetime counts, and voided orders', () => {
    const orders: PnlShopifyOrder[] = [
      order(1, '2026-11-27T15:00:00Z', '100.00'),
      order(2, '2026-11-27T18:30:00Z', '40.00', { id: 9, orders_count: 0 }),
      {
        ...order(3, '2026-11-27T19:00:00Z', '25.00', { id: 9, orders_count: 0 }),
        lifetimeOrdersCount: 2,
      },
      { ...order(4, '2026-11-27T20:00:00Z', '999.00'), financial_status: 'voided' },
    ];
    orders[1].lifetimeOrdersCount = 2;
    const zone = 'America/New_York';
    const sales = salesByDay(orders, zone);
    const buckets = aggregateOrdersByDay(orders, zone);
    for (const [day, bucket] of Array.from(buckets.entries())) {
      const got = sales.get(day);
      expect(got?.revenue).toBe(bucket.gross_sales);
      expect(got?.ncRevenue).toBe(bucket.nc_revenue);
      expect(got?.rcRevenue).toBe(bucket.rc_revenue);
      expect(got?.ncOrders).toBe(bucket.nc_orders);
      expect(got?.rcOrders).toBe(bucket.rc_orders);
    }
    expect(sales.get('2026-11-27')?.orders).toBe(3);
  });
});
