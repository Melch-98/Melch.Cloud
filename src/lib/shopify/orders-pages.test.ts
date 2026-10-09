import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildFullCoveredDayRows } from './pnl-covered-days.ts';
import { collectPagedOrders, retryAfterDelayMs, type OrdersPageResult } from './orders-pages.ts';

const page1 = {
  id: 1,
  created_at: '2026-10-02T15:00:00-04:00',
  financial_status: 'paid',
  subtotal_price: '3061.00',
  total_discounts: '0',
  total_tax: '0',
  customer: null,
};

function page(status: number, body: unknown, extra: Partial<OrdersPageResult> = {}): OrdersPageResult {
  return {
    ok: status >= 200 && status < 300,
    status,
    retryAfter: null,
    link: null,
    body,
    ...extra,
  };
}

test('a failed orders page 2 throws and no daily_pnl rows are built', async () => {
  let rows: unknown = null;
  const slept: number[] = [];
  await assert.rejects(
    async () => {
      const orders = await collectPagedOrders(
        [page1],
        'https://shop.example/orders?page_info=page2',
        async () => page(503, { orders: [] }),
        async (ms) => {
          slept.push(ms);
        }
      );
      rows = buildFullCoveredDayRows({
        brandId: 'mintier',
        currency: 'USD',
        syncedAt: '2026-10-05T17:00:00.000Z',
        coveredDays: ['2026-10-02', '2026-10-03'],
        buckets: new Map(),
        meta: { ok: false, byDay: new Map() },
        google: { ok: false, byDay: new Map() },
      });
      assert.ok(orders);
    },
    (err: unknown) => {
      assert.equal((err as Error).message, 'Shopify orders page 503');
      return true;
    }
  );
  assert.equal(rows, null);
  assert.deepEqual(slept, []);
});

test('a 429 on page 2 retries with Retry-After and then throws without building rows', async () => {
  let rows: unknown = null;
  const slept: number[] = [];
  let calls = 0;
  await assert.rejects(
    async () => {
      const orders = await collectPagedOrders(
        [page1],
        'https://shop.example/orders?page_info=page2',
        async () => {
          calls += 1;
          return page(429, null, { retryAfter: calls === 1 ? '4' : null });
        },
        async (ms) => {
          slept.push(ms);
        }
      );
      rows = buildFullCoveredDayRows({
        brandId: 'mintier',
        currency: 'USD',
        syncedAt: '2026-10-05T17:00:00.000Z',
        coveredDays: ['2026-10-02'],
        buckets: new Map(),
        meta: { ok: false, byDay: new Map() },
        google: { ok: false, byDay: new Map() },
      });
      assert.ok(orders);
    },
    (err: unknown) => {
      assert.equal((err as Error).message, 'Shopify orders page 429');
      return true;
    }
  );
  assert.equal(calls, 3);
  assert.deepEqual(slept, [4_000, retryAfterDelayMs(null)]);
  assert.equal(rows, null);
});

test('a 429 that recovers on the third try keeps page 2 orders', async () => {
  let calls = 0;
  const orders = await collectPagedOrders(
    [page1],
    'https://shop.example/orders?page_info=page2',
    async () => {
      calls += 1;
      if (calls < 3) return page(429, null, { retryAfter: '2' });
      return page(200, {
        orders: [{ ...page1, id: 2, subtotal_price: '10.00' }],
      });
    },
    async () => {}
  );
  assert.equal(calls, 3);
  assert.equal(orders.length, 2);
});

test('a page whose orders field is not an array throws before rows are built', async () => {
  let rows: unknown = null;
  await assert.rejects(
    async () => {
      await collectPagedOrders([page1], 'https://shop.example/orders?page_info=page2', async () => page(200, { orders: null }), async () => {});
      rows = [];
    },
    (err: unknown) => {
      assert.equal((err as Error).message, 'Shopify orders page missing orders');
      return true;
    }
  );
  assert.equal(rows, null);
});
