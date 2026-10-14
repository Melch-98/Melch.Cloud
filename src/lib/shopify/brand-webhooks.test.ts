import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerBrandOrderWebhooks } from './brand-webhooks';
import { registerWebhooks, WEBHOOK_TOPICS } from './webhooks';

const domain = 'mintier.myshopify.com';
const token = 'shpat-test';
const appBase = 'https://melch.cloud';

type Remote = { id: number; topic: string; address: string; format?: string };

afterEach(() => {
  vi.unstubAllGlobals();
});

function installFetch(state: { webhooks: Remote[]; posts: number }) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method || 'GET').toUpperCase();
      if (method === 'GET' && url.includes('/webhooks.json')) {
        return new Response(JSON.stringify({ webhooks: state.webhooks }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (method === 'POST' && url.endsWith('/webhooks.json')) {
        state.posts += 1;
        const body = JSON.parse(String(init?.body)) as { webhook: { topic: string; address: string } };
        const webhook: Remote = {
          id: 5000 + state.webhooks.length,
          topic: body.webhook.topic,
          address: body.webhook.address,
          format: 'json',
        };
        state.webhooks.push(webhook);
        return new Response(JSON.stringify({ webhook }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('unexpected', { status: 500 });
    })
  );
}

describe('Shopify webhook registration', () => {
  it('does not create a second subscription when order webhooks are ensured again', async () => {
    const state = { webhooks: [] as Remote[], posts: 0 };
    installFetch(state);

    const first = await registerBrandOrderWebhooks(domain, token, 'read_orders,write_orders');
    expect(state.posts).toBe(3);
    expect(first.topics.map((topic) => topic.status)).toEqual(['created', 'created', 'created']);
    expect(state.webhooks.map((webhook) => webhook.address)).toEqual([
      `${appBase}/api/shopify/webhooks/orders-create`,
      `${appBase}/api/shopify/webhooks/orders-updated`,
      `${appBase}/api/shopify/webhooks/orders-cancelled`,
    ]);

    const postsAfterFirst = state.posts;
    const second = await registerBrandOrderWebhooks(domain, token, 'read_orders,write_orders');
    expect(state.posts).toBe(postsAfterFirst);
    expect(state.webhooks).toHaveLength(3);
    expect(second.topics.map((topic) => topic.status)).toEqual([
      'already_registered',
      'already_registered',
      'already_registered',
    ]);
    expect(second.scopeError).toBeNull();
  });

  it('leaves an order topic that already points at the shared receiver', async () => {
    const state = {
      webhooks: [
        {
          id: 9,
          topic: 'orders/updated',
          address: `${appBase}/api/shopify/webhooks/orders`,
        },
      ] as Remote[],
      posts: 0,
    };
    installFetch(state);

    const result = await registerBrandOrderWebhooks(domain, token, null);
    expect(state.posts).toBe(2);
    const updated = result.topics.find((topic) => topic.topic === 'orders/updated');
    expect(updated?.status).toBe('already_registered');
    expect(updated?.id).toBe(9);
    expect(state.webhooks.filter((webhook) => webhook.topic === 'orders/updated')).toHaveLength(1);
  });

  it('does not POST install topics that are already registered', async () => {
    const state = { webhooks: [] as Remote[], posts: 0 };
    installFetch(state);

    const first = await registerWebhooks(domain, token);
    expect(first).toHaveLength(WEBHOOK_TOPICS.length);
    expect(state.posts).toBe(WEBHOOK_TOPICS.length);
    expect(first.every((row) => row.id != null && !row.error)).toBe(true);

    const postsAfterFirst = state.posts;
    const second = await registerWebhooks(domain, token);
    expect(state.posts).toBe(postsAfterFirst);
    expect(state.webhooks).toHaveLength(WEBHOOK_TOPICS.length);
    expect(second.map((row) => row.id)).toEqual(first.map((row) => row.id));
  });
});
