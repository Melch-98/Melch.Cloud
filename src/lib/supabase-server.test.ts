import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as cronRoute from '@/app/api/cron/usage-tasks/route';
import * as usageRoute from '@/app/api/submissions/usage-task/route';
import { createServiceClient } from '@/lib/supabase-server';

const createClient = vi.hoisted(() => vi.fn(() => ({ ok: true })));

vi.mock('@supabase/supabase-js', () => ({
  createClient,
}));

describe('createServiceClient', () => {
  const prevUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const prevKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  beforeEach(() => {
    createClient.mockClear();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role';
  });

  afterEach(() => {
    if (prevUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = prevUrl;
    if (prevKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = prevKey;
    vi.unstubAllGlobals();
  });

  it('returns null when the service env is missing', () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    expect(createServiceClient()).toBeNull();
    expect(createClient).not.toHaveBeenCalled();
  });

  it('opts PostgREST fetches out of the Next.js 14 data cache', async () => {
    createServiceClient();
    const options = createClient.mock.calls[0][2] as {
      global: { fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> };
    };
    const inner = vi.fn(async () => new Response('[]'));
    vi.stubGlobal('fetch', inner);

    const url = 'https://example.supabase.co/rest/v1/submissions?select=id&usage_end_date=gte.2026-10-09&notion_page_id=is.null';
    await options.global.fetch(url, { method: 'GET', headers: { apikey: 'service-role' }, cache: 'force-cache' });
    await options.global.fetch(url, { method: 'GET', headers: { apikey: 'service-role' } });

    expect(inner).toHaveBeenCalledTimes(2);
    for (const call of inner.mock.calls) {
      expect(call[0]).toBe(url);
      expect(call[1]).toMatchObject({
        cache: 'no-store',
        method: 'GET',
        headers: { apikey: 'service-role' },
      });
    }
  });
});

describe('usage task routes', () => {
  it('opt the segment out of the Next.js fetch cache', () => {
    expect(cronRoute.dynamic).toBe('force-dynamic');
    expect(cronRoute.fetchCache).toBe('force-no-store');
    expect(cronRoute.revalidate).toBe(0);
    expect(usageRoute.dynamic).toBe('force-dynamic');
    expect(usageRoute.fetchCache).toBe('force-no-store');
    expect(usageRoute.revalidate).toBe(0);
  });
});
