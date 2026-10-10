import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const TOKEN = 'shpat_scope_probe_token';
const SECRET = 'shpss_client_secret_value';

const state = vi.hoisted(() => ({
  authed: true,
  role: 'admin' as string | null,
  brands: [] as Array<Record<string, unknown>>,
  store: null as Record<string, unknown> | null,
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: {
      getUser: async (token: string) => {
        if (!state.authed || token !== 'good') return { data: { user: null }, error: { message: 'bad token' } };
        return { data: { user: { id: 'admin-1' } }, error: null };
      },
    },
    from: (table: string) => {
      const filters: Record<string, unknown> = {};
      const api: Record<string, unknown> = {};
      const self = () => api;
      api.select = self;
      api.eq = (col: string, val: unknown) => {
        filters[col] = val;
        return api;
      };
      api.ilike = (col: string, val: unknown) => {
        filters[col] = val;
        return api;
      };
      api.is = self;
      api.maybeSingle = async () => {
        if (table === 'shopify_stores') return { data: state.store, error: null };
        return { data: null, error: null };
      };
      api.single = async () => {
        if (table === 'users_profile') {
          return {
            data: state.role ? { role: state.role } : null,
            error: state.role ? null : { message: 'missing' },
          };
        }
        return { data: null, error: null };
      };
      api.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => {
        if (table === 'brands') {
          const name = String(filters.name || '').toLowerCase();
          const rows = state.brands.filter(
            (row) => String(row.name).toLowerCase() === name && !row.archived_at
          );
          return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
        }
        return Promise.resolve({ data: null, error: null }).then(resolve, reject);
      };
      return api;
    },
  }),
}));

import * as scopesRoute from '@/app/api/admin/shopify-scopes/route';

const fetchMock = vi.fn();

function call(url: string, token?: string) {
  return scopesRoute.GET(
    new NextRequest(url, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    })
  );
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service';
  process.env.CRON_SECRET = 'cron-secret';
  state.authed = true;
  state.role = 'admin';
  state.store = null;
  state.brands = [
    {
      id: 'brand-1',
      name: 'Mintier',
      archived_at: null,
      shopify_store_domain: 'mintier.myshopify.com',
      shopify_client_id: 'client-id',
      shopify_client_secret: SECRET,
    },
  ];
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string) => {
    const href = String(url);
    if (href.includes('/admin/oauth/access_token')) {
      return new Response(JSON.stringify({ access_token: TOKEN, scope: 'read_orders,read_products' }), {
        status: 200,
      });
    }
    if (href.endsWith('/admin/oauth/access_scopes.json')) {
      return new Response(
        JSON.stringify({
          access_scopes: [{ handle: 'read_orders' }, { handle: 'read_all_orders' }],
        }),
        { status: 200 }
      );
    }
    return new Response('missing', { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
});

describe('GET /api/admin/shopify-scopes', () => {
  it('opts the segment out of the Next.js fetch cache', () => {
    expect(scopesRoute.dynamic).toBe('force-dynamic');
    expect(scopesRoute.fetchCache).toBe('force-no-store');
    expect(scopesRoute.revalidate).toBe(0);
  });

  it('rejects a missing session and a non-admin', async () => {
    const missing = await call('http://localhost/api/admin/shopify-scopes?brand_name=Mintier');
    expect(missing.status).toBe(401);

    state.role = 'founder';
    const founder = await call('http://localhost/api/admin/shopify-scopes?brand_name=Mintier', 'good');
    expect(founder.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('requires a brand name and 404s when the brand is missing', async () => {
    const missingName = await call('http://localhost/api/admin/shopify-scopes', 'cron-secret');
    expect(missingName.status).toBe(400);

    state.brands = [];
    const missingBrand = await call('http://localhost/api/admin/shopify-scopes?brand_name=Mintier', 'cron-secret');
    expect(missingBrand.status).toBe(404);
  });

  it('returns exchange scopes and granted handles for a cron caller without the token', async () => {
    const res = await call('http://localhost/api/admin/shopify-scopes?brand_name=Mintier', 'cron-secret');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      brand: 'Mintier',
      shop_domain: 'mintier.myshopify.com',
      token_scopes: 'read_orders,read_products',
      granted_scopes: ['read_orders', 'read_all_orders'],
      has_read_all_orders_token: false,
      has_read_all_orders_granted: true,
    });

    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain(TOKEN);
    expect(serialized).not.toContain(SECRET);

    const tokenCall = fetchMock.mock.calls.find((call) => String(call[0]).includes('/admin/oauth/access_token'));
    const scopesCall = fetchMock.mock.calls.find((call) => String(call[0]).includes('access_scopes.json'));
    expect(tokenCall).toBeTruthy();
    expect(String(scopesCall?.[0])).toBe('https://mintier.myshopify.com/admin/oauth/access_scopes.json');
    expect(String(scopesCall?.[0])).not.toContain(TOKEN);
    const headers = new Headers(scopesCall?.[1]?.headers);
    expect(headers.get('X-Shopify-Access-Token')).toBe(TOKEN);
  });

  it('uses a stored install token and its scope string for an admin', async () => {
    state.store = {
      access_token: TOKEN,
      scopes: 'read_orders,read_all_orders',
      uninstalled_at: null,
      shop_domain: 'mintier.myshopify.com',
    };
    state.brands[0].shopify_client_id = null;
    state.brands[0].shopify_client_secret = null;

    const res = await call('http://localhost/api/admin/shopify-scopes?brand_name=Mintier', 'good');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      brand: 'Mintier',
      shop_domain: 'mintier.myshopify.com',
      token_scopes: 'read_orders,read_all_orders',
      granted_scopes: ['read_orders', 'read_all_orders'],
      has_read_all_orders_token: true,
      has_read_all_orders_granted: true,
    });
    expect(JSON.stringify(body)).not.toContain(TOKEN);
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes('access_token'))).toBe(false);
  });
});
