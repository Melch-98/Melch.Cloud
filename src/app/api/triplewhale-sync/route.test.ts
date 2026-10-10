import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const state = vi.hoisted(() => ({
  authed: true,
  role: 'founder' as string | null,
  brandId: 'brand-1' as string | null,
  getUserCalls: 0,
}));

const runTripleWhaleBrandSync = vi.hoisted(() =>
  vi.fn(async () => NextResponse.json({ success: true, daysUpserted: 1 }))
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

vi.mock('@/lib/shopify/run-triplewhale-brand-sync', () => ({
  runTripleWhaleBrandSync,
}));

import { POST } from '@/app/api/triplewhale-sync/route';

function post(body: unknown, token?: string) {
  return new NextRequest('http://localhost/api/triplewhale-sync', {
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
  runTripleWhaleBrandSync.mockClear();
});

describe('POST /api/triplewhale-sync brand auth', () => {
  it('rejects signed-out callers and a founder syncing another brand', async () => {
    expect((await POST(post({ brandId: 'brand-1' }))).status).toBe(401);

    const other = await POST(post({ brandId: 'brand-2' }, 'good'));
    expect(other.status).toBe(403);
    expect(runTripleWhaleBrandSync).not.toHaveBeenCalled();

    const wrongKey = await POST(post({ brand_id: 'brand-1' }, 'good'));
    expect(wrongKey.status).toBe(403);
    expect(runTripleWhaleBrandSync).not.toHaveBeenCalled();
  });

  it('lets a founder sync their brand and lets admin and cron sync any brand', async () => {
    const own = await POST(post({ brandId: 'brand-1' }, 'good'));
    expect(own.status).toBe(200);
    expect(runTripleWhaleBrandSync).toHaveBeenCalledWith(expect.anything(), { brandId: 'brand-1' });

    state.role = 'admin';
    const admin = await POST(post({ brandId: 'brand-2' }, 'good'));
    expect(admin.status).toBe(200);

    state.getUserCalls = 0;
    const cron = await POST(post({ brandId: 'brand-9' }, 'cron-secret'));
    expect(cron.status).toBe(200);
    expect(state.getUserCalls).toBe(0);
    expect(runTripleWhaleBrandSync).toHaveBeenLastCalledWith(expect.anything(), { brandId: 'brand-9' });

    state.role = 'strategist';
    const strategist = await POST(post({ brandId: 'brand-1' }, 'good'));
    expect(strategist.status).toBe(403);
  });
});
