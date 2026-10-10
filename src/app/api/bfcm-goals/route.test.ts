import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { backfillAuth, goalAccess } from '@/lib/bfcm/goals-access';

const state = vi.hoisted(() => ({
  userId: 'user-1',
  authed: true,
  profile: { role: 'founder', brand_id: 'brand-1' } as { role: string; brand_id: string | null } | null,
  goals: [] as Array<Record<string, unknown>>,
  upserts: [] as unknown[],
  goalError: null as { message: string } | null,
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: {
      getUser: async (token: string) => {
        if (!state.authed || token !== 'good') return { data: { user: null }, error: { message: 'bad token' } };
        return { data: { user: { id: state.userId } }, error: null };
      },
    },
    from: (table: string) => {
      const api: Record<string, unknown> = {};
      const self = () => api;
      api.select = self;
      api.eq = self;
      api.gte = self;
      api.lte = self;
      api.order = self;
      api.single = async () => {
        if (table === 'users_profile') return { data: state.profile, error: state.profile ? null : { message: 'missing' } };
        return { data: state.goals[0] ?? null, error: state.goalError };
      };
      api.upsert = () => {
        api.select = self;
        return api;
      };
      api.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => {
        if (table === 'bfcm_goals') {
          state.upserts.push({ table });
          return Promise.resolve({ data: state.goals, error: state.goalError }).then(resolve, reject);
        }
        return Promise.resolve({ data: null, error: null }).then(resolve, reject);
      };
      return api;
    },
  }),
}));

import { GET, PUT } from '@/app/api/bfcm-goals/route';

function call(method: 'GET' | 'PUT', url: string, body?: unknown, token = 'good') {
  return (method === 'GET' ? GET : PUT)(
    new NextRequest(url, {
      method,
      headers: token ? { authorization: `Bearer ${token}` } : {},
      body: body == null ? undefined : JSON.stringify(body),
    })
  );
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service';
  state.userId = 'user-1';
  state.authed = true;
  state.profile = { role: 'founder', brand_id: 'brand-1' };
  state.goals = [{ date: '2026-11-27', revenue_goal: 1000, spend_budget: 400, amer_target: 2.5, updated_at: '2026-10-10T00:00:00Z' }];
  state.upserts = [];
  state.goalError = null;
});

describe('goal access rules', () => {
  it('lets admins write any brand, founders write their own, and strategists only read', () => {
    expect(goalAccess('admin', null, 'brand-2')).toBe('write');
    expect(goalAccess('founder', 'brand-1', 'brand-1')).toBe('write');
    expect(goalAccess('founder', 'brand-1', 'brand-2')).toBe('none');
    expect(goalAccess('strategist', 'brand-1', 'brand-1')).toBe('read');
    expect(goalAccess('user', 'brand-1', 'brand-1')).toBe('none');
    expect(goalAccess('founder', null, 'brand-1')).toBe('none');
  });
});

describe('backfill auth', () => {
  it('accepts the cron secret or an admin and rejects everyone else', () => {
    expect(backfillAuth({ authorization: 'Bearer cron', cronSecret: 'cron', role: null })).toBe('cron');
    expect(backfillAuth({ authorization: 'Bearer session', cronSecret: 'cron', role: 'admin' })).toBe('admin');
    expect(backfillAuth({ authorization: 'Bearer session', cronSecret: 'cron', role: 'founder' })).toBe('forbidden');
    expect(backfillAuth({ authorization: null, cronSecret: 'cron', role: null })).toBe('unauthorized');
  });
});

describe('GET/PUT /api/bfcm-goals', () => {
  it('rejects a missing session', async () => {
    const res = await GET(new NextRequest('http://localhost/api/bfcm-goals?brandId=brand-1&from=2026-11-23&to=2026-11-30'));
    expect(res.status).toBe(401);
  });

  it('lets a founder read their brand and blocks another brand', async () => {
    const ok = await call('GET', 'http://localhost/api/bfcm-goals?brandId=brand-1&from=2026-11-23&to=2026-11-30');
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body.goals[0].revenueGoal).toBe(1000);
    expect(body.access).toBe('write');

    const denied = await call('GET', 'http://localhost/api/bfcm-goals?brandId=brand-2&from=2026-11-23&to=2026-11-30');
    expect(denied.status).toBe(403);
  });

  it('lets a strategist read and refuses a write', async () => {
    state.profile = { role: 'strategist', brand_id: 'brand-1' };
    const read = await call('GET', 'http://localhost/api/bfcm-goals?brandId=brand-1&from=2026-11-23&to=2026-11-30');
    expect(read.status).toBe(200);
    expect((await read.json()).access).toBe('read');
    const write = await call('PUT', 'http://localhost/api/bfcm-goals', {
      brandId: 'brand-1',
      date: '2026-11-27',
      revenueGoal: 1,
    });
    expect(write.status).toBe(403);
  });

  it('lets an admin write a brand they are not assigned to', async () => {
    state.profile = { role: 'admin', brand_id: null };
    const res = await call('PUT', 'http://localhost/api/bfcm-goals', {
      brandId: 'brand-9',
      date: '2026-11-27',
      revenueGoal: 5000,
      spendBudget: 2000,
      amerTarget: 2,
    });
    expect(res.status).toBe(200);
  });

  it('refuses a negative goal', async () => {
    const res = await call('PUT', 'http://localhost/api/bfcm-goals', {
      brandId: 'brand-1',
      date: '2026-11-27',
      revenueGoal: -5,
    });
    expect(res.status).toBe(400);
  });
});
