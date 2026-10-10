import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const state = vi.hoisted(() => ({
  authed: true,
  role: 'founder' as string | null,
  brandId: 'brand-1' as string | null,
  getUserCalls: 0,
}));

const runShopifyBrandSync = vi.hoisted(() =>
  vi.fn(async () => NextResponse.json({ success: true }))
);

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: {
      getUser: async (token: string) => {
        state.getUserCalls += 1;
        if (!state.authed || token !== 'good') return { data: { user: null }, error: { message: 'bad token' } };
        return { data: { user: { id: 'user-1' } }, error: null };
      },
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({
            data: state.role ? { role: state.role, brand_id: state.brandId } : null,
            error: state.role ? null : { message: 'missing' },
          }),
        }),
      }),
    }),
  }),
}));

vi.mock('@/lib/shopify/run-shopify-brand-sync', () => ({
  runShopifyBrandSync,
  resolveBrandReportingCurrency: vi.fn(),
}));

vi.mock('@/lib/redis', () => ({
  getCachedPnl: vi.fn(async () => null),
  setCachedPnl: vi.fn(),
}));

import { GET, POST } from '@/app/api/shopify-sync/route';

function post(body: unknown, token?: string) {
  return new NextRequest('http://localhost/api/shopify-sync?brand_id=brand-1', {
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
  state.getUserCalls = 0;
  runShopifyBrandSync.mockClear();
});

describe('POST /api/shopify-sync brand auth', () => {
  it('rejects signed-out, unknown, and strategist callers', async () => {
    expect((await POST(post({ brand_id: 'brand-1' }))).status).toBe(401);
    expect((await POST(post({ brand_id: 'brand-1' }, 'nope'))).status).toBe(401);

    state.role = 'strategist';
    const strategist = await POST(post({ brand_id: 'brand-1' }, 'good'));
    expect(strategist.status).toBe(403);
    expect(runShopifyBrandSync).not.toHaveBeenCalled();
  });

  it('lets a founder sync only their brand', async () => {
    const own = await POST(post({ brand_id: 'brand-1' }, 'good'));
    expect(own.status).toBe(200);
    expect(runShopifyBrandSync).toHaveBeenCalledWith(expect.anything(), { brand_id: 'brand-1' });

    runShopifyBrandSync.mockClear();
    const other = await POST(post({ brand_id: 'brand-2' }, 'good'));
    expect(other.status).toBe(403);
    const body = await other.json();
    expect(body.error).toMatch(/own brand/);
    expect(runShopifyBrandSync).not.toHaveBeenCalled();

    state.brandId = null;
    const unassigned = await POST(post({ brand_id: 'brand-1' }, 'good'));
    expect(unassigned.status).toBe(403);
    expect(runShopifyBrandSync).not.toHaveBeenCalled();
  });

  it('lets an admin or the cron secret sync any brand', async () => {
    state.role = 'admin';
    state.brandId = null;
    const admin = await POST(post({ brand_id: 'brand-2' }, 'good'));
    expect(admin.status).toBe(200);
    expect(runShopifyBrandSync).toHaveBeenCalledWith(expect.anything(), { brand_id: 'brand-2' });

    runShopifyBrandSync.mockClear();
    state.getUserCalls = 0;
    const cron = await POST(post({ brand_id: 'brand-9' }, 'cron-secret'));
    expect(cron.status).toBe(200);
    expect(state.getUserCalls).toBe(0);
    expect(runShopifyBrandSync).toHaveBeenCalledWith(expect.anything(), { brand_id: 'brand-9' });

    delete process.env.CRON_SECRET;
    const unset = await POST(post({ brand_id: 'brand-9' }, 'cron-secret'));
    expect(unset.status).toBe(401);
  });

  it('keeps GET behind a session', async () => {
    const res = await GET(new NextRequest('http://localhost/api/shopify-sync?brand_id=brand-1'));
    expect(res.status).toBe(401);
    expect(runShopifyBrandSync).not.toHaveBeenCalled();
  });
});
