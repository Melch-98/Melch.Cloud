import { describe, expect, it } from 'vitest';
import type { LiveCreativeDraft } from '@/lib/live-creatives/assets';
import { CRON_OMITTED_COLUMNS, effectiveProduct, mergeCronRow } from '@/lib/live-creatives/merge';
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

function expectNoProtectedKeys(row: Record<string, unknown>) {
  for (const key of CRON_OMITTED_COLUMNS) {
    expect(key in row).toBe(false);
  }
}

describe('mergeCronRow', () => {
  it('omits manual columns and product_source and keeps first_seen', () => {
    const merged = mergeCronRow(
      { first_seen: '2026-10-01T00:00:00.000Z' },
      incoming,
      '2026-10-10T12:00:00.000Z',
    );
    expectNoProtectedKeys(merged as unknown as Record<string, unknown>);
    expect(merged.product_key).toBe('product:soap');
    expect(merged.first_seen).toBe('2026-10-01T00:00:00.000Z');
    expect(merged.last_active).toBe('2026-10-10T12:00:00.000Z');
  });

  it('stamps first_seen on a new row and still omits the override columns', () => {
    const merged = mergeCronRow(null, incoming, '2026-10-10T12:00:00.000Z');
    expectNoProtectedKeys(merged as unknown as Record<string, unknown>);
    expect(merged.first_seen).toBe('2026-10-10T12:00:00.000Z');
    expect(merged.product_key).toBe('product:soap');
  });
});

describe('effectiveProduct', () => {
  it('lets a stored manual override win over the URL mapping', () => {
    expect(effectiveProduct({
      ...incoming,
      manual_product_key: 'product:tallow-balm',
      manual_product_label: 'Tallow Balm',
      manual_product_kind: 'product',
      product_source: 'manual',
    })).toMatchObject({
      product_key: 'product:tallow-balm',
      product_label: 'Tallow Balm',
      product_source: 'manual',
    });
  });

  it('uses the URL product when there is no override', () => {
    expect(effectiveProduct(incoming).product_key).toBe('product:soap');
  });
});

describe('syncLiveCreatives manual override', () => {
  function fakeSupabase(stored: Map<string, Record<string, unknown>>, upserts: unknown[][], selects: string[]) {
    return {
      from(table: string) {
        const api: Record<string, unknown> = {};
        const self = () => api;
        api.select = (cols: string) => {
          if (table === 'live_creatives') selects.push(cols);
          return api;
        };
        api.is = self;
        api.not = self;
        api.order = self;
        api.eq = self;
        api.in = self;
        api.upsert = (rows: Array<Record<string, unknown>>) => {
          upserts.push(rows);
          for (const row of rows) {
            const key = `${row.ad_id}::${row.asset_key}`;
            const current = { ...(stored.get(key) || {}) };
            for (const [column, value] of Object.entries(row)) current[column] = value;
            stored.set(key, current);
          }
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
            const row = stored.get('ad-1::still-1');
            const snapshot = row
              ? [{ ad_id: row.ad_id, asset_key: row.asset_key, first_seen: row.first_seen }]
              : [];
            // The cron has its snapshot. An override saved after that read
            // must still be on the row when the upsert lands.
            if (row) {
              row.manual_product_key = 'product:tallow-balm';
              row.manual_product_label = 'Tallow Balm';
              row.manual_product_kind = 'product';
              row.product_source = 'manual';
            }
            return Promise.resolve({ data: snapshot, error: null }).then(resolve, reject);
          }
          return Promise.resolve({ data: null, error: null }).then(resolve, reject);
        };
        return api;
      },
    };
  }

  const graph = async (url: string, token: string) => {
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
  };

  it('writes no manual or product_source keys and does not put the token in the Meta URL', async () => {
    const upserts: unknown[][] = [];
    const selects: string[] = [];
    const stored = new Map<string, Record<string, unknown>>([
      ['ad-1::still-1', {
        ad_id: 'ad-1',
        asset_key: 'still-1',
        first_seen: '2026-10-01T00:00:00.000Z',
        product_key: 'product:old',
        manual_product_key: null,
        product_source: null,
      }],
    ]);
    const seen: string[] = [];
    const { results } = await syncLiveCreatives({
      supabase: fakeSupabase(stored, upserts, selects),
      token: 'meta-token-should-not-leak',
      now: new Date('2026-10-10T12:00:00.000Z'),
      budgetMs: 60_000,
      graph: async (url, token) => {
        seen.push(url);
        return graph(url, token);
      },
    });

    expect(results[0]).toMatchObject({ ok: true, ads: 1, rows: 1 });
    expect(seen.every((url) => !url.includes('access_token'))).toBe(true);
    expect(selects).toEqual(['ad_id, asset_key, first_seen']);
    const row = (upserts[0] as Array<Record<string, unknown>>)[0];
    expectNoProtectedKeys(row);
    expect(row.product_key).toBe('product:soap');
    expect(row.first_seen).toBe('2026-10-01T00:00:00.000Z');
    expect(row.last_active).toBe('2026-10-10T12:00:00.000Z');
    expect(row.asset_key).toBe('still-1');
  });

  it('keeps an override saved after the cron read', async () => {
    const upserts: unknown[][] = [];
    const stored = new Map<string, Record<string, unknown>>([
      ['ad-1::still-1', {
        ad_id: 'ad-1',
        asset_key: 'still-1',
        first_seen: '2026-10-01T00:00:00.000Z',
        product_key: 'product:old',
        manual_product_key: null,
        manual_product_label: null,
        manual_product_kind: null,
        product_source: null,
      }],
    ]);
    await syncLiveCreatives({
      supabase: fakeSupabase(stored, upserts, []),
      token: 'meta-token-should-not-leak',
      now: new Date('2026-10-10T12:00:00.000Z'),
      budgetMs: 60_000,
      graph,
    });

    const row = stored.get('ad-1::still-1');
    expect(row?.manual_product_key).toBe('product:tallow-balm');
    expect(row?.manual_product_label).toBe('Tallow Balm');
    expect(row?.manual_product_kind).toBe('product');
    expect(row?.product_source).toBe('manual');
    expect(row?.product_key).toBe('product:soap');
    expect(effectiveProduct({
      product_key: row?.product_key as string,
      manual_product_key: row?.manual_product_key as string,
      manual_product_label: row?.manual_product_label as string,
      manual_product_kind: row?.manual_product_kind as string,
      product_source: row?.product_source as string,
    }).product_key).toBe('product:tallow-balm');
  });

  it('keeps the first draft when a flexible ad repeats an image hash', async () => {
    const upserts: unknown[][] = [];
    const { results } = await syncLiveCreatives({
      supabase: fakeSupabase(new Map(), upserts, []),
      token: 'meta-token-should-not-leak',
      now: new Date('2026-10-10T12:00:00.000Z'),
      budgetMs: 60_000,
      graph: async (url, token) => {
        expect(token).toBe('meta-token-should-not-leak');
        if (url.includes('/ads?')) {
          return {
            data: [{
              id: 'ad-1',
              name: 'Flexible soap',
              creative: { id: 'cr-1' },
              adset: { is_dynamic_creative: true, promoted_object: {} },
            }],
          };
        }
        return {
          'cr-1': {
            id: 'cr-1',
            asset_feed_spec: {
              ad_formats: ['AUTOMATIC_FORMAT'],
              images: [
                { hash: 'hash-dup', url: 'https://cdn.example/a.jpg' },
                { hash: 'hash-dup', url: 'https://cdn.example/a-copy.jpg' },
              ],
              link_urls: [
                { website_url: 'https://mintier.com/products/soap' },
                { website_url: 'https://mintier.com/products/tallow-balm' },
              ],
            },
          },
        };
      },
    });

    expect(results[0]).toMatchObject({ ok: true, ads: 1, rows: 1, duplicates: 1 });
    const rows = upserts[0] as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0].asset_key).toBe('hash-dup');
    expect(rows[0].ad_id).toBe('ad-1');
    expect(rows[0].product_key).toBe('product:soap');
  });
});
