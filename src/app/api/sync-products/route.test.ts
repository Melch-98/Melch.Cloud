import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

type BrandRow = {
  id: string;
  name: string;
  shopify_store_domain: string;
  shopify_client_id: string;
  shopify_client_secret: string;
};

const state = vi.hoisted(() => ({
  authed: true,
  role: 'founder' as string | null,
  brandId: 'brand-1' as string | null,
  fetches: [] as string[],
  upserts: [] as Array<Record<string, unknown>>,
  queriedIds: [] as string[],
  brands: [
    {
      id: 'brand-1',
      name: 'Brand One',
      shopify_store_domain: 'brand-one.myshopify.com',
      shopify_client_id: 'client-1',
      shopify_client_secret: 'secret-1',
    },
    {
      id: 'brand-2',
      name: 'Brand Two',
      shopify_store_domain: 'brand-two.myshopify.com',
      shopify_client_id: 'client-2',
      shopify_client_secret: 'secret-2',
    },
  ] as BrandRow[],
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
      if (table === 'users_profile') {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({
                data: state.role ? { role: state.role, brand_id: state.brandId } : null,
                error: state.role ? null : { message: 'missing' },
              }),
            }),
          }),
        };
      }
      if (table === 'shopify_products') {
        return {
          upsert: async (row: Record<string, unknown>) => {
            state.upserts.push(row);
            return { error: null };
          },
        };
      }
      const filters: Record<string, unknown> = {};
      const api = {
        select: () => api,
        is: () => api,
        not: () => api,
        eq: (col: string, val: unknown) => {
          filters[col] = val;
          return api;
        },
        then: (
          resolve: (value: { data: BrandRow[]; error: null }) => unknown,
          reject: (reason: unknown) => unknown
        ) => {
          const rows = state.brands.filter((brand) => filters.id == null || brand.id === filters.id);
          state.queriedIds = rows.map((brand) => brand.id);
          return Promise.resolve({ data: rows, error: null as null }).then(resolve, reject);
        },
      };
      return api;
    },
  }),
}));

import { POST } from '@/app/api/sync-products/route';

function post(body: unknown, token?: string) {
  return new NextRequest('http://localhost/api/sync-products', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service';
  process.env.CRON_SECRET = 'cron-secret';
  state.authed = true;
  state.role = 'founder';
  state.brandId = 'brand-1';
  state.fetches = [];
  state.upserts = [];
  state.queriedIds = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const url = String(input);
    state.fetches.push(url);
    if (url.includes('/admin/oauth/access_token')) {
      return new Response(JSON.stringify({ access_token: 'shop-token' }), { status: 200 });
    }
    return new Response(
      JSON.stringify({
        products: [
          {
            id: 11,
            title: 'Soap',
            handle: 'soap',
            status: 'active',
            product_type: 'bar',
            vendor: 'Test',
            tags: 'clean',
            variants: [],
            images: [],
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-02T00:00:00Z',
          },
        ],
      }),
      { status: 200 }
    );
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('POST /api/sync-products brand auth', () => {
  it('returns 400 when a founder omits brand_id', async () => {
    const res = await POST(post({}, 'good'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('brand_id is required');
    expect(state.fetches).toEqual([]);
    expect(state.queriedIds).toEqual([]);
  });

  it('returns 403 when a founder syncs another brand', async () => {
    const res = await POST(post({ brand_id: 'brand-2' }, 'good'));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/own brand/);
    expect(state.fetches).toEqual([]);
    expect(state.queriedIds).toEqual([]);
  });

  it('lets a founder sync their own brand', async () => {
    const res = await POST(post({ brand_id: 'brand-1' }, 'good'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results).toEqual([{ brand: 'Brand One', products: 1, error: null }]);
    expect(state.queriedIds).toEqual(['brand-1']);
    expect(state.fetches.every((url) => url.includes('brand-one.myshopify.com'))).toBe(true);
    expect(state.upserts.map((row) => row.brand_id)).toEqual(['brand-1']);
  });

  it('lets an admin sync every credentialed brand when brand_id is omitted', async () => {
    state.role = 'admin';
    state.brandId = null;
    const res = await POST(post({}, 'good'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results).toEqual([
      { brand: 'Brand One', products: 1, error: null },
      { brand: 'Brand Two', products: 1, error: null },
    ]);
    expect(state.queriedIds).toEqual(['brand-1', 'brand-2']);
  });

  it('returns 401 when the caller is unauthenticated', async () => {
    const missing = await POST(post({ brand_id: 'brand-1' }));
    expect(missing.status).toBe(401);
    const bad = await POST(post({ brand_id: 'brand-1' }, 'nope'));
    expect(bad.status).toBe(401);
    expect(state.fetches).toEqual([]);
    expect(state.queriedIds).toEqual([]);
  });
});
