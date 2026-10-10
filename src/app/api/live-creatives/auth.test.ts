import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const state = vi.hoisted(() => ({
  authed: true,
  profile: { role: 'founder', brand_id: 'brand-1' } as { role: string; brand_id: string | null } | null,
  rows: [{ brand_id: 'brand-1', ad_id: 'ad-1', asset_key: 'still-1', product_key: 'product:soap', product_label: 'Soap Bar', product_kind: 'product', manual_product_key: null, manual_product_label: null, manual_product_kind: null }] as Array<Record<string, unknown>>,
  products: [{ handle: 'soap', title: 'Soap Bar' }] as Array<Record<string, unknown>>,
  updates: [] as unknown[],
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: {
      getUser: async (token: string) => {
        if (!state.authed || token !== 'good') return { data: { user: null }, error: { message: 'bad token' } };
        return { data: { user: { id: 'user-1' } }, error: null };
      },
    },
    from: (table: string) => {
      const api: Record<string, unknown> = {};
      const filters: Array<[string, unknown]> = [];
      const self = () => api;
      api.select = self;
      api.eq = (col: string, val: unknown) => {
        filters.push([col, val]);
        return api;
      };
      api.order = self;
      api.in = self;
      api.is = self;
      api.not = self;
      api.update = (patch: unknown) => {
        api._update = patch;
        return api;
      };
      api.single = async () => {
        if (table === 'users_profile') {
          return { data: state.profile, error: state.profile ? null : { message: 'missing' } };
        }
        return { data: null, error: null };
      };
      api.maybeSingle = async () => ({ data: null, error: null });
      api.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => {
        if (api._update) {
          const brand = filters.find((filter) => filter[0] === 'brand_id')?.[1];
          const ad = filters.find((filter) => filter[0] === 'ad_id')?.[1];
          const matched = state.rows.filter((row) => row.brand_id === brand && row.ad_id === ad);
          state.updates.push({ patch: api._update, count: matched.length });
          return Promise.resolve({ data: matched, error: null }).then(resolve, reject);
        }
        if (table === 'live_creatives') return Promise.resolve({ data: state.rows, error: null }).then(resolve, reject);
        if (table === 'shopify_products') return Promise.resolve({ data: state.products, error: null }).then(resolve, reject);
        return Promise.resolve({ data: [], error: null }).then(resolve, reject);
      };
      return api;
    },
  }),
}));

vi.mock('@/lib/live-creatives/sync', () => ({
  readMetaToken: vi.fn(async () => ''),
  syncLiveCreatives: vi.fn(),
}));

import { GET as cronGET } from '@/app/api/cron/live-creatives/route';
import { GET } from '@/app/api/live-creatives/route';
import { PUT } from '@/app/api/live-creatives/override/route';
import { POST } from '@/app/api/live-creatives/sync/route';

function request(url: string, method: 'GET' | 'PUT' | 'POST', body?: unknown, token?: string) {
  return new NextRequest(url, {
    method,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    body: body == null ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service';
  process.env.CRON_SECRET = 'cron-secret';
  state.authed = true;
  state.profile = { role: 'founder', brand_id: 'brand-1' };
  state.rows = [{
    brand_id: 'brand-1',
    ad_id: 'ad-1',
    asset_key: 'still-1',
    product_key: 'product:soap',
    product_label: 'Soap Bar',
    product_kind: 'product',
    manual_product_key: null,
    manual_product_label: null,
    manual_product_kind: null,
  }];
  state.updates = [];
});

describe('live creative auth', () => {
  it('returns 401 for a signed-out cron call', async () => {
    const missing = await cronGET(request('http://localhost/api/cron/live-creatives', 'GET'));
    expect(missing.status).toBe(401);
    const session = await cronGET(request('http://localhost/api/cron/live-creatives', 'GET', undefined, 'good'));
    expect(session.status).toBe(401);
  });

  it('returns 401 for a signed-out override and list', async () => {
    const list = await GET(request('http://localhost/api/live-creatives?brandId=brand-1', 'GET'));
    expect(list.status).toBe(401);
    const override = await PUT(request('http://localhost/api/live-creatives/override', 'PUT', {
      brandId: 'brand-1',
      adId: 'ad-1',
      productKey: 'product:soap',
      productLabel: 'Soap Bar',
      productKind: 'product',
    }));
    expect(override.status).toBe(401);
    const sync = await POST(request('http://localhost/api/live-creatives/sync', 'POST', {}));
    expect(sync.status).toBe(401);
  });

  it('lets a founder override their brand and blocks a strategist and another brand', async () => {
    const ok = await PUT(request('http://localhost/api/live-creatives/override', 'PUT', {
      brandId: 'brand-1',
      adId: 'ad-1',
      productKey: 'homepage',
      productLabel: 'Homepage',
      productKind: 'homepage',
    }, 'good'));
    expect(ok.status).toBe(200);
    expect(state.updates).toHaveLength(1);

    const other = await PUT(request('http://localhost/api/live-creatives/override', 'PUT', {
      brandId: 'brand-2',
      adId: 'ad-1',
      productKey: 'homepage',
      productLabel: 'Homepage',
      productKind: 'homepage',
    }, 'good'));
    expect(other.status).toBe(403);

    state.profile = { role: 'strategist', brand_id: 'brand-1' };
    const strategist = await PUT(request('http://localhost/api/live-creatives/override', 'PUT', {
      brandId: 'brand-1',
      adId: 'ad-1',
      productKey: 'homepage',
      productLabel: 'Homepage',
      productKind: 'homepage',
    }, 'good'));
    expect(strategist.status).toBe(403);

    const read = await GET(request('http://localhost/api/live-creatives?brandId=brand-1', 'GET', undefined, 'good'));
    expect(read.status).toBe(200);
    const body = await read.json();
    expect(body.access).toBe('read');
    expect(body.rows[0].product_label).toBe('Soap Bar');
  });

  it('refuses a founder manual sync', async () => {
    const res = await POST(request('http://localhost/api/live-creatives/sync', 'POST', { brandId: 'brand-1' }, 'good'));
    expect(res.status).toBe(403);
  });
});
