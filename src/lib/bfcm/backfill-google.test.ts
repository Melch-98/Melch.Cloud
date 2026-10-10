import { describe, expect, it } from 'vitest';
import { sumGoogleToday } from '@/lib/bfcm/google-today';
import { backfillResponseStatus, readAllOrdersWarning, safeShopifyNextUrl } from '@/lib/shopify/order-backfill';

describe('Google today rows', () => {
  it('sums cost micros and conversion value from one GAQL day', () => {
    const totals = sumGoogleToday([
      { metrics: { costMicros: '2500000', conversionsValue: 40, conversions: 2 } },
      { metrics: { costMicros: 500000, conversionsValue: '10.5', conversions: 1 } },
    ]);
    expect(totals.spend).toBe(3);
    expect(totals.conversionValue).toBe(50.5);
    expect(totals.conversions).toBe(3);
  });
});

describe('Shopify backfill resume URL', () => {
  it('keeps a same-shop orders page and drops an access token', () => {
    const next = safeShopifyNextUrl(
      'https://mintier.myshopify.com/admin/api/2026-04/orders.json?limit=250&page_info=abc&access_token=secret',
      'mintier.myshopify.com'
    );
    expect(next).toContain('page_info=abc');
    expect(next).not.toContain('secret');
    expect(next).not.toContain('access_token');
  });

  it('warns instead of reporting success when a 60-day-old range comes back empty', () => {
    const now = new Date('2026-10-10T00:43:00Z');
    const warning = readAllOrdersWarning('2025-11-15', 0, now);
    expect(warning).toContain('read_all_orders');
    expect(warning).toContain('60 days');
    expect(readAllOrdersWarning('2025-11-15', 12, now)).toBeNull();
    expect(readAllOrdersWarning('2026-09-01', 0, now)).toBeNull();
    expect(backfillResponseStatus({
      error: null,
      warning,
      fetched: 0,
      upserted: 0,
      truncated: false,
    })).toEqual({ ok: false, status: 422 });
    expect(backfillResponseStatus({
      error: null,
      warning: null,
      fetched: 0,
      upserted: 0,
      truncated: false,
    })).toEqual({ ok: true, status: 200 });
  });

  it('rejects a URL for a different host', () => {
    expect(
      safeShopifyNextUrl('https://evil.example/orders.json?page_info=abc', 'mintier.myshopify.com')
    ).toBeNull();
  });
});
