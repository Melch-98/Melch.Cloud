import { describe, expect, it } from 'vitest';
import { sumGoogleToday } from '@/lib/bfcm/google-today';
import { safeShopifyNextUrl } from '@/lib/shopify/order-backfill';

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
      'https://mintier.myshopify.com/admin/api/2024-01/orders.json?limit=250&page_info=abc&access_token=secret',
      'mintier.myshopify.com'
    );
    expect(next).toContain('page_info=abc');
    expect(next).not.toContain('secret');
    expect(next).not.toContain('access_token');
  });

  it('rejects a URL for a different host', () => {
    expect(
      safeShopifyNextUrl('https://evil.example/orders.json?page_info=abc', 'mintier.myshopify.com')
    ).toBeNull();
  });
});
