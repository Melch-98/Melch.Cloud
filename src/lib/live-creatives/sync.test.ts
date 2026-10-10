import { describe, expect, it } from 'vitest';
import { CREATIVE_FIELD_LIST, POST_FIELDS, dropCreativeField, rejectedCreativeField, syncLiveCreatives } from '@/lib/live-creatives/sync';

const TOKEN = 'meta-token-should-not-leak';

function fakeSupabase(upserts: Array<Array<Record<string, unknown>>>) {
  return {
    from(table: string) {
      const api: Record<string, unknown> = {};
      const self = () => api;
      api.select = self;
      api.is = self;
      api.not = self;
      api.order = self;
      api.eq = self;
      api.in = self;
      api.upsert = (rows: Array<Record<string, unknown>>) => {
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
            data: [{ handle: 'soap', title: 'Soap Bar' }],
            error: null,
          }).then(resolve, reject);
        }
        return Promise.resolve({ data: [], error: null }).then(resolve, reject);
      };
      return api;
    },
  };
}

function idsIn(url: string): string[] {
  const raw = /[?&]ids=([^&]+)/.exec(url)?.[1] || '';
  return raw.split(',').filter(Boolean).map((id) => decodeURIComponent(id));
}

describe('rejectedCreativeField', () => {
  it('names the field Graph rejected and drops it', () => {
    const message = '(#100) Tried accessing nonexisting field (destination_spec) on node type (AdCreative)';
    expect(rejectedCreativeField(message)).toBe('destination_spec');
    expect(rejectedCreativeField('(#100) Missing permissions')).toBeNull();
    const next = dropCreativeField(CREATIVE_FIELD_LIST, 'destination_spec');
    expect(next).not.toContain('destination_spec');
    expect(next).toContain('call_to_action');
    expect(next).toContain('creative_sourcing_spec');
  });
});

describe('syncLiveCreatives post destinations', () => {
  it('fetches page posts in chunks of 25, skips Instagram-only, and counts rows still none', async () => {
    const ads = Array.from({ length: 26 }, (_, index) => ({
      id: `ad-${index}`,
      name: `Post ${index}`,
      creative: { id: `cr-${index}` },
      adset: { is_dynamic_creative: false, promoted_object: {} },
    }));
    ads.push(
      {
        id: 'ad-ig',
        name: 'IG',
        creative: { id: 'cr-ig' },
        adset: { is_dynamic_creative: false, promoted_object: {} },
      },
      {
        id: 'ad-empty',
        name: 'Empty',
        creative: { id: 'cr-empty' },
        adset: { is_dynamic_creative: false, promoted_object: {} },
      },
    );
    const seen: string[] = [];
    const upserts: Array<Array<Record<string, unknown>>> = [];
    const { results } = await syncLiveCreatives({
      supabase: fakeSupabase(upserts),
      token: TOKEN,
      now: new Date('2026-10-10T12:00:00.000Z'),
      budgetMs: 60_000,
      graph: async (url, token) => {
        expect(token).toBe(TOKEN);
        expect(url).not.toContain('access_token');
        expect(url).not.toContain(TOKEN);
        seen.push(url);
        if (url.includes('/ads?')) return { data: ads };
        const ids = idsIn(url);
        const body: Record<string, unknown> = {};
        if (url.includes('attachments{')) {
          expect(url).toContain(POST_FIELDS);
          for (const id of ids) {
            body[id] = {
              id,
              call_to_action: { type: 'SHOP_NOW', value: { link: 'https://mintier.com/products/soap' } },
            };
          }
          return body;
        }
        for (const id of ids) {
          if (id === 'cr-ig') {
            body[id] = {
              id,
              name: 'Instagram post: beach',
              effective_instagram_media_id: '1789',
              effective_object_story_id: '900_1',
            };
          } else if (id === 'cr-empty') {
            body[id] = { id, name: 'No destination' };
          } else {
            const index = id.slice('cr-'.length);
            body[id] = { id, effective_object_story_id: `100_${index}` };
          }
        }
        return body;
      },
    });

    const creativeCalls = seen.filter((url) => url.includes('object_story_spec'));
    const postCalls = seen.filter((url) => url.includes('attachments{'));
    expect(creativeCalls.map((url) => idsIn(url).length)).toEqual([25, 3]);
    expect(postCalls.map((url) => idsIn(url).length)).toEqual([25, 1]);
    expect(postCalls.flatMap(idsIn)).not.toContain('900_1');
    expect(postCalls.flatMap(idsIn)).toContain('100_0');
    expect(results[0]).toMatchObject({ ok: true, ads: 28, none: 1, noneAdIds: ['ad-empty'] });
    const rows = upserts.flat();
    expect(rows.find((row) => row.ad_id === 'ad-0')?.product_key).toBe('product:soap');
    expect(rows.find((row) => row.ad_id === 'ad-ig')?.product_kind).toBe('ig_profile');
    expect(rows.find((row) => row.ad_id === 'ad-empty')?.product_label).toBe('No landing page');
    expect(JSON.stringify(results)).not.toContain(TOKEN);
  });

  it('drops a creative field Graph rejects and does not put the token in the error', async () => {
    const seen: string[] = [];
    const { results } = await syncLiveCreatives({
      supabase: fakeSupabase([]),
      token: TOKEN,
      now: new Date('2026-10-10T12:00:00.000Z'),
      budgetMs: 60_000,
      graph: async (url, token) => {
        expect(url).not.toContain(TOKEN);
        seen.push(url);
        if (url.includes('destination_spec')) {
          throw new Error(`(#100) Tried accessing nonexisting field (destination_spec) access_token=${token}`);
        }
        if (url.includes('/ads?')) {
          return {
            data: [{
              id: 'ad-1',
              name: 'Soap',
              creative: { id: 'cr-1' },
              adset: { is_dynamic_creative: false, promoted_object: {} },
            }],
          };
        }
        return {
          'cr-1': {
            id: 'cr-1',
            link_url: 'https://mintier.com/products/soap',
          },
        };
      },
    });

    const creativeCalls = seen.filter((url) => url.includes('link_url'));
    expect(creativeCalls[0]).toContain('destination_spec');
    expect(creativeCalls[1]).not.toContain('destination_spec');
    expect(creativeCalls[1]).toContain('call_to_action');
    expect(results[0]).toMatchObject({ ok: true, rows: 1, none: 0, noneAdIds: [] });
    expect(JSON.stringify(results)).not.toContain(TOKEN);
  });

  it('keeps a successful brand sync when a post fetch returns #100', async () => {
    const seen: string[] = [];
    const upserts: Array<Array<Record<string, unknown>>> = [];
    const adset = { is_dynamic_creative: false, promoted_object: {} };
    const { results } = await syncLiveCreatives({
      supabase: fakeSupabase(upserts),
      token: TOKEN,
      now: new Date('2026-10-10T12:00:00.000Z'),
      budgetMs: 60_000,
      graph: async (url) => {
        expect(url).not.toContain(TOKEN);
        seen.push(url);
        if (url.includes('/ads?')) {
          return {
            data: [
              { id: 'ad-link', name: 'Linked', creative: { id: 'cr-link' }, adset },
              { id: 'ad-ok', name: 'Readable post', creative: { id: 'cr-ok' }, adset },
              { id: 'ad-bad', name: 'Unreadable post', creative: { id: 'cr-bad' }, adset },
            ],
          };
        }
        if (url.includes('attachments{')) {
          const ids = idsIn(url);
          if (ids.length > 1) throw new Error(`(#100) Missing permissions ${TOKEN}`);
          if (ids[0] === '11_1') {
            return {
              '11_1': {
                id: '11_1',
                call_to_action: { type: 'SHOP_NOW', value: { link: 'https://mintier.com/products/soap' } },
              },
            };
          }
          throw new Error(`(#100) Missing permissions ${TOKEN}`);
        }
        return {
          'cr-link': { id: 'cr-link', link_url: 'https://mintier.com/products/soap' },
          'cr-ok': { id: 'cr-ok', effective_object_story_id: '11_1' },
          'cr-bad': { id: 'cr-bad', effective_object_story_id: '22_2' },
        };
      },
    });

    expect(results[0]).toMatchObject({ ok: true, ads: 3, postFetchFailed: 1 });
    expect(results[0].error).toBeUndefined();
    const rows = upserts.flat();
    expect(rows.find((row) => row.ad_id === 'ad-link')?.product_key).toBe('product:soap');
    expect(rows.find((row) => row.ad_id === 'ad-ok')?.product_key).toBe('product:soap');
    expect(rows.find((row) => row.ad_id === 'ad-bad')?.product_label).toBe('No landing page');
    expect(seen.filter((url) => url.includes('attachments{')).map(idsIn)).toEqual([
      ['11_1', '22_2'],
      ['11_1'],
      ['22_2'],
    ]);
    expect(JSON.stringify(results)).not.toContain(TOKEN);
    expect(JSON.stringify(upserts)).not.toContain(TOKEN);
  });

  it('retries a post id that comes back as a #100 node and still syncs', async () => {
    const upserts: Array<Array<Record<string, unknown>>> = [];
    const adset = { is_dynamic_creative: false, promoted_object: {} };
    const { results } = await syncLiveCreatives({
      supabase: fakeSupabase(upserts),
      token: TOKEN,
      now: new Date('2026-10-10T12:00:00.000Z'),
      budgetMs: 60_000,
      graph: async (url) => {
        if (url.includes('/ads?')) {
          return {
            data: [
              { id: 'ad-ok', name: 'Ok', creative: { id: 'cr-ok' }, adset },
              { id: 'ad-bad', name: 'Bad', creative: { id: 'cr-bad' }, adset },
            ],
          };
        }
        if (url.includes('attachments{')) {
          const ids = idsIn(url);
          if (ids.length > 1) {
            return {
              '11_1': {
                id: '11_1',
                call_to_action: { type: 'SHOP_NOW', value: { link: 'https://mintier.com/products/soap' } },
              },
              '22_2': { error: { message: `(#100) Missing permissions ${TOKEN}`, code: 100 } },
            };
          }
          throw new Error(`(#100) Missing permissions ${TOKEN}`);
        }
        return {
          'cr-ok': { id: 'cr-ok', effective_object_story_id: '11_1' },
          'cr-bad': { id: 'cr-bad', effective_object_story_id: '22_2' },
        };
      },
    });
    expect(results[0]).toMatchObject({ ok: true, postFetchFailed: 1 });
    const rows = upserts.flat();
    expect(rows.find((row) => row.ad_id === 'ad-ok')?.product_key).toBe('product:soap');
    expect(rows.find((row) => row.ad_id === 'ad-bad')?.product_kind).toBe('none');
    expect(JSON.stringify(results)).not.toContain(TOKEN);
  });

  it('drops a new creative field that returns #100 and still syncs the brand', async () => {
    const seen: string[] = [];
    const upserts: Array<Array<Record<string, unknown>>> = [];
    const { results } = await syncLiveCreatives({
      supabase: fakeSupabase(upserts),
      token: TOKEN,
      now: new Date('2026-10-10T12:00:00.000Z'),
      budgetMs: 60_000,
      graph: async (url, token) => {
        expect(url).not.toContain(TOKEN);
        seen.push(url);
        if (url.includes('/ads?')) {
          return {
            data: [{
              id: 'ad-1',
              name: 'Soap',
              creative: { id: 'cr-1' },
              adset: { is_dynamic_creative: false, promoted_object: {} },
            }],
          };
        }
        if (url.includes('creative_sourcing_spec')) {
          throw new Error(`(#100) Missing permissions ${token}`);
        }
        return { 'cr-1': { id: 'cr-1', link_url: 'https://mintier.com/products/soap' } };
      },
    });

    expect(results[0]).toMatchObject({ ok: true, rows: 1, postFetchFailed: 0, none: 0 });
    expect(upserts.flat()[0]?.product_key).toBe('product:soap');
    const creativeUrls = seen.filter((url) => url.includes('object_story_spec'));
    expect(creativeUrls.some((url) => url.includes('creative_sourcing_spec'))).toBe(true);
    expect(creativeUrls.some((url) => url.includes('call_to_action') && !url.includes('creative_sourcing_spec'))).toBe(true);
    expect(JSON.stringify(results)).not.toContain(TOKEN);
  });
});
