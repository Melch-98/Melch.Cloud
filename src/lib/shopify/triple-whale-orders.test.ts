import assert from 'node:assert/strict';
import { test } from 'node:test';
import { tripleWhaleOrderRows } from './triple-whale-orders.ts';

test('maps a Triple Whale order onto shopify_orders and keeps the sync source', () => {
  const [row] = tripleWhaleOrderRows('organicjaguar.myshopify.com', 'brand-1', [
    {
      order_id: '100',
      customer_id: '7',
      order_revenue: 42.5,
      gross_sales: 40,
      taxes: 2.5,
      discount_amount: 1,
      processed_at: '2026-09-22T03:39:04.000Z',
      event_date: '2026-09-22',
    },
  ]);
  assert.equal(row.shop_domain, 'organicjaguar.myshopify.com');
  assert.equal(row.brand_id, 'brand-1');
  assert.equal(row.shopify_order_id, 100);
  assert.equal(row.customer_id, 7);
  assert.equal(row.source_name, 'triplewhale-sync');
  assert.equal(row.shopify_created_at, '2026-09-22T03:39:04.000Z');
  assert.equal(row.financial_status, 'paid');
});

test('skips rows that are not numeric Shopify order ids', () => {
  const rows = tripleWhaleOrderRows('organicjaguar.myshopify.com', 'brand-1', [
    { order_id: 'not-a-number', event_date: '2026-09-22' },
    { order_id: null, event_date: '2026-09-22' },
  ]);
  assert.equal(rows.length, 0);
});
