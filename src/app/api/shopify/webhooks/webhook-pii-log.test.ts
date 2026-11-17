import { afterEach, describe, expect, it, vi } from 'vitest';
import { dispatchShopifyWebhook } from '@/lib/shopify/webhook-handlers';

const payload = {
  id: 99,
  email: 'buyer@example.com',
  customer: { email: 'buyer@example.com', phone: '+15551212' },
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Shopify webhook logs', () => {
  it('logs a refund as topic and shop, without the payload', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const result = await dispatchShopifyWebhook({
      supabase: null,
      topic: 'refunds/create',
      shop: 'mintier.myshopify.com',
      payload,
    });
    expect(result).toEqual({ ok: true });
    expect(spy).toHaveBeenCalledTimes(1);
    const line = JSON.stringify(spy.mock.calls);
    expect(line).toContain('refunds/create');
    expect(line).toContain('mintier.myshopify.com');
    expect(line).not.toContain('buyer@example.com');
    expect(line).not.toContain('+15551212');
  });

  it.each(['customers/data_request', 'customers/redact', 'shop/redact'])(
    'logs %s as topic and shop, without the payload',
    async (topic) => {
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const result = await dispatchShopifyWebhook({
        supabase: null,
        topic,
        shop: 'tallow.myshopify.com',
        payload,
      });
      expect(result).toEqual({ ok: true });
      expect(spy).toHaveBeenCalledTimes(1);
      const line = JSON.stringify(spy.mock.calls);
      expect(line).toContain(topic);
      expect(line).toContain('tallow.myshopify.com');
      expect(line).not.toContain('buyer@example.com');
      expect(line).not.toContain('+15551212');
    }
  );
});
