import crypto from 'crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.hoisted(() => {
  process.env.SHOPIFY_API_SECRET = 'melch-secret';
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role';
});

type StoredOrder = Record<string, unknown>;

const state = vi.hoisted(() => ({
  client: null as FakeClient | null,
}));

type FakeClient = {
  from: (table: string) => FakeBuilder;
  orders: Map<string, StoredOrder>;
  upserts: Array<{ onConflict: string | undefined; shopify_order_id: unknown }>;
  uninstalls: Array<{ shop_domain: unknown; uninstalled_at: unknown }>;
};

type FakeBuilder = {
  select: () => FakeBuilder;
  ilike: () => FakeBuilder;
  not: () => FakeBuilder;
  limit: () => FakeBuilder;
  eq: (column: string, value: unknown) => FakeBuilder;
  maybeSingle: () => Promise<{ data: { brand_id: string } | null; error: null }>;
  update: (patch: Record<string, unknown>) => FakeBuilder;
  upsert: (
    row: StoredOrder,
    options?: { onConflict?: string }
  ) => Promise<{ error: null }>;
  then: (
    onFulfilled: (value: { data: unknown[]; error: null }) => unknown,
    onRejected?: (reason: unknown) => unknown
  ) => Promise<unknown>;
};

function createFakeClient(): FakeClient {
  const orders = new Map<string, StoredOrder>();
  const upserts: FakeClient['upserts'] = [];
  const uninstalls: FakeClient['uninstalls'] = [];

  function from(table: string): FakeBuilder {
    const filters: Record<string, unknown> = {};
    let patch: Record<string, unknown> | null = null;
    const builder = {
      select() {
        return builder;
      },
      ilike() {
        return builder;
      },
      not() {
        return builder;
      },
      limit() {
        return builder;
      },
      eq(column: string, value: unknown) {
        filters[column] = value;
        return builder;
      },
      maybeSingle() {
        if (table === 'shopify_stores') {
          return Promise.resolve({ data: { brand_id: 'brand-mintier' }, error: null as null });
        }
        return Promise.resolve({ data: null, error: null as null });
      },
      update(next: Record<string, unknown>) {
        patch = next;
        return builder;
      },
      upsert(row: StoredOrder, options?: { onConflict?: string }) {
        const key = `${row.shop_domain}:${row.shopify_order_id}`;
        orders.set(key, row);
        upserts.push({ onConflict: options?.onConflict, shopify_order_id: row.shopify_order_id });
        return Promise.resolve({ error: null as null });
      },
      then(
        onFulfilled: (value: { data: unknown[]; error: null }) => unknown,
        onRejected?: (reason: unknown) => unknown
      ) {
        if (table === 'shopify_stores' && patch) {
          uninstalls.push({
            shop_domain: filters.shop_domain,
            uninstalled_at: patch.uninstalled_at,
          });
        }
        return Promise.resolve({ data: [] as unknown[], error: null as null }).then(onFulfilled, onRejected);
      },
    };
    return builder;
  }

  return { from, orders, upserts, uninstalls };
}

vi.mock('@/lib/supabase-server', () => ({
  createServiceClient: () => state.client,
}));

import { POST } from '@/app/api/shopify/webhooks/[topic]/route';

function sign(body: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(body, 'utf8').digest('base64');
}

function webhook(topic: string, body: string, hmac: string | null) {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-shopify-shop-domain': 'mintier.myshopify.com',
    'x-shopify-topic': topic,
  };
  if (hmac) headers['x-shopify-hmac-sha256'] = hmac;
  return new NextRequest(`http://localhost/api/shopify/webhooks/${topic.replace('/', '-')}`, {
    method: 'POST',
    headers,
    body,
  });
}

const order = {
  id: 1001,
  name: '#1001',
  email: 'buyer@example.com',
  total_price: '42.00',
  currency: 'USD',
  financial_status: 'paid',
  created_at: '2026-10-13T15:00:00Z',
  updated_at: '2026-10-13T15:00:00Z',
};

beforeEach(() => {
  state.client = createFakeClient();
});

describe('POST /api/shopify/webhooks/[topic]', () => {
  it('rejects a bad HMAC with 401 and does not write', async () => {
    const body = JSON.stringify(order);
    const res = await POST(webhook('orders/create', body, sign(body, 'attacker')), {
      params: { topic: 'orders-create' },
    });
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe('Invalid HMAC');
    expect(state.client?.orders.size).toBe(0);
    expect(state.client?.upserts).toEqual([]);
    expect(state.client?.uninstalls).toEqual([]);
  });

  it('upserts orders/create, orders/updated, and orders/cancelled on the same order id', async () => {
    const createdBody = JSON.stringify(order);
    const created = await POST(webhook('orders/create', createdBody, sign(createdBody, 'melch-secret')), {
      params: { topic: 'orders-create' },
    });
    expect(created.status).toBe(200);

    const updatedOrder = { ...order, total_price: '40.00', financial_status: 'paid', updated_at: '2026-10-13T16:00:00Z' };
    const updatedBody = JSON.stringify(updatedOrder);
    const updated = await POST(webhook('orders/updated', updatedBody, sign(updatedBody, 'melch-secret')), {
      params: { topic: 'orders-updated' },
    });
    expect(updated.status).toBe(200);

    const cancelledOrder = {
      ...updatedOrder,
      financial_status: 'refunded',
      cancelled_at: '2026-10-13T17:00:00Z',
      updated_at: '2026-10-13T17:00:00Z',
    };
    const cancelledBody = JSON.stringify(cancelledOrder);
    const cancelled = await POST(
      webhook('orders/cancelled', cancelledBody, sign(cancelledBody, 'melch-secret')),
      { params: { topic: 'orders-cancelled' } }
    );
    expect(cancelled.status).toBe(200);

    expect(state.client?.orders.size).toBe(1);
    const row = state.client?.orders.get('mintier.myshopify.com:1001');
    expect(row).toMatchObject({
      shop_domain: 'mintier.myshopify.com',
      brand_id: 'brand-mintier',
      shopify_order_id: 1001,
      total_price: 40,
      financial_status: 'refunded',
      order_number: '#1001',
    });
    expect(row?.raw).toMatchObject({ cancelled_at: '2026-10-13T17:00:00Z' });
    expect(state.client?.upserts).toEqual([
      { onConflict: 'shop_domain,shopify_order_id', shopify_order_id: 1001 },
      { onConflict: 'shop_domain,shopify_order_id', shopify_order_id: 1001 },
      { onConflict: 'shop_domain,shopify_order_id', shopify_order_id: 1001 },
    ]);
  });

  it('treats a second delivery of the same order as the same row', async () => {
    const body = JSON.stringify(order);
    const request = () =>
      POST(webhook('orders/updated', body, sign(body, 'melch-secret')), {
        params: { topic: 'orders-updated' },
      });
    expect((await request()).status).toBe(200);
    expect((await request()).status).toBe(200);
    expect(state.client?.orders.size).toBe(1);
    expect(state.client?.upserts).toHaveLength(2);
    expect(state.client?.upserts.every((call) => call.onConflict === 'shop_domain,shopify_order_id')).toBe(true);
  });

  it('writes shopify_stores once for app/uninstalled', async () => {
    const body = JSON.stringify({ id: 1 });
    const res = await POST(webhook('app/uninstalled', body, sign(body, 'melch-secret')), {
      params: { topic: 'app-uninstalled' },
    });
    expect(res.status).toBe(200);
    expect(state.client?.uninstalls).toHaveLength(1);
    expect(state.client?.uninstalls[0]?.shop_domain).toBe('mintier.myshopify.com');
    expect(typeof state.client?.uninstalls[0]?.uninstalled_at).toBe('string');
    expect(state.client?.orders.size).toBe(0);
  });

  it('does not touch shopify_stores when the service client is missing', async () => {
    state.client = null;
    const body = JSON.stringify({ id: 1 });
    const res = await POST(webhook('app/uninstalled', body, sign(body, 'melch-secret')), {
      params: { topic: 'app-uninstalled' },
    });
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe('Server config error: missing Supabase credentials');
  });
});
