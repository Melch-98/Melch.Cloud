import { describe, expect, it } from 'vitest';
import type { LiveCreativeDraft } from '@/lib/live-creatives/assets';
import { effectiveProduct, mergeCronRow } from '@/lib/live-creatives/merge';
import { syncLiveCreatives } from '@/lib/live-creatives/sync';

const incoming: LiveCreativeDraft = {
  brand_id: 'brand-1',
  platform: 'meta',
  ad_id: 'ad-1',
  asset_key: 'still-1',
  creative_id: 'cr-1',
  format: 'Image',
  landing_url: 'https://mintier.com/products/soap',
  landing_url_normalized: 'https://mintier.com/products/soap',
  product_key: 'product:soap',
  product_label: 'Soap Bar',
  product_kind: 'product',
  ad_name: 'Soap ad',
  asset_name: 'still-1',
  thumbnail_url: null,
  card_products: null,
  product_source: 'url',
};

describe('mergeCronRow', () => {
  it('lets a manual override win and keeps first_seen', () => {
    const merged = mergeCronRow(
      {
        first_seen: '2026-10-01T00:00:00.000Z',
        manual_product_key: 'product:tallow-balm',
        manual_product_label: 'Tallow Balm',
        manual_product_kind: 'product',
      },
      incoming,
      '2026-10-10T12:00:00.000Z',
    );
    expect(merged.manual_product_key).toBe('product:tallow-balm');
    expect(merged.manual_product_label).toBe('Tallow Balm');
    expect(merged.product_source).toBe('manual');
    expect(merged.product_key).toBe('product:soap');
    expect(merged.first_seen).toBe('2026-10-01T00:00:00.000Z');
    expect(merged.last_active).toBe('2026-10-10T12:00:00.000Z');
    expect(effectiveProduct(merged)).toMatchObject({
      product_key: 'product:tallow-balm',
      product_label: 'Tallow Balm',
      product_source: 'manual',
    });
  });

  it('uses the URL product when there is no override', () => {
    const merged = mergeCronRow(null, incoming, '2026-10-10T12:00:00.000Z');
    expect(merged.product_source).toBe('url');
    expect(merged.manual_product_key).toBeNull();
    expect(merged.first_seen).toBe('2026-10-10T12:00:00.000Z');
    expect(effectiveProduct(merged).product_key).toBe('product:soap');
  });
});

describe('syncLiveCreatives manual override', () => {
  it('writes the override back and does not put the token in the Meta URL', async () => {
    const upserts: unknown[][] = [];
    const supabase = {
      from(table: string) {
        const api: Record<string, unknown> = {};
        const self = () => api;
        api.select = self;
        api.is = self;
        api.not = self;
        api.order = self;
        api.eq = self;
        api.in = self;
        api.upsert = (rows: unknown[]) => {
          upserts.push(rows);
          return api;
        };
        api.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => {
          if (table === 'brands') {
            return Promise.resolve({
              data: [{
                id: 'brand-1',
                name: 'Mintier',
                website_url: 'https://mintier.com',
                shopify_store_domain: 'mintier.myshopify.com',
                meta_ad_account_id: 'act_1',
              }],
              error: null,
            }).then(resolve, reject);
          }
          if (table === 'shopify_products') {
            return Promise.resolve({
              data: [{ handle: 'soap', title: 'Soap Bar' }, { handle: 'tallow-balm', title: 'Tallow Balm' }],
              error: null,
            }).then(resolve, reject);
          }
          if (table === 'shopify_stores') {
            return Promise.resolve({ data: [], error: null }).then(resolve, reject);
          }
          if (table === 'live_creatives' && upserts.length === 0) {
            return Promise.resolve({
              data: [{
                ad_id: 'ad-1',
                asset_key: 'still-1',
                first_seen: '2026-10-01T00:00:00.000Z',
                manual_product_key: 'product:tallow-balm',
                manual_product_label: 'Tallow Balm',
                manual_product_kind: 'product',
              }],
              error: null,
            }).then(resolve, reject);
          }
          return Promise.resolve({ data: null, error: null }).then(resolve, reject);
        };
        return api;
      },
    };

    const seen: string[] = [];
    const { results } = await syncLiveCreatives({
      supabase,
      token: 'meta-token-should-not-leak',
      now: new Date('2026-10-10T12:00:00.000Z'),
      budgetMs: 60_000,
      graph: async (url, token) => {
        seen.push(url);
        expect(token).toBe('meta-token-should-not-leak');
        expect(url).not.toContain('access_token');
        expect(url).not.toContain('meta-token-should-not-leak');
        if (url.includes('/ads?')) {
          return {
            data: [{
              id: 'ad-1',
              name: 'Soap ad',
              creative: { id: 'cr-1' },
              adset: { is_dynamic_creative: false, promoted_object: {} },
            }],
          };
        }
        return {
          'cr-1': {
            id: 'cr-1',
            image_hash: 'still-1',
            object_story_spec: { link_data: { link: 'https://mintier.com/products/soap?utm_source=fb' } },
          },
        };
      },
    });

    expect(results[0]).toMatchObject({ ok: true, ads: 1, rows: 1 });
    expect(seen.every((url) => !url.includes('access_token'))).toBe(true);
    const row = (upserts[0] as Array<Record<string, unknown>>)[0];
    expect(row.manual_product_key).toBe('product:tallow-balm');
    expect(row.product_source).toBe('manual');
    expect(row.product_key).toBe('product:soap');
    expect(row.first_seen).toBe('2026-10-01T00:00:00.000Z');
    expect(row.last_active).toBe('2026-10-10T12:00:00.000Z');
    expect(row.asset_key).toBe('still-1');
  });
});
