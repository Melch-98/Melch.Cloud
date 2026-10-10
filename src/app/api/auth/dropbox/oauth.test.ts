import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { signDropboxOAuthState } from '@/lib/dropbox-oauth-state';

const mocks = vi.hoisted(() => ({
  userId: 'admin-1',
  role: 'admin' as string | null,
  authed: true,
  exchange: vi.fn(),
  email: vi.fn(async () => 'ops@example.com'),
  upsert: vi.fn(async (payload: Record<string, unknown>, options?: { onConflict?: string }) => {
    void payload;
    void options;
    return { error: null as { message: string } | null };
  }),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: {
      getUser: async (token: string) => {
        if (!mocks.authed || token !== 'good') return { data: { user: null }, error: { message: 'bad token' } };
        return { data: { user: { id: mocks.userId } }, error: null };
      },
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({
            data: mocks.role ? { role: mocks.role } : null,
            error: mocks.role ? null : { message: 'missing' },
          }),
        }),
      }),
    }),
  }),
}));

vi.mock('@/lib/dropbox', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/dropbox')>();
  return {
    ...actual,
    exchangeDropboxCode: mocks.exchange,
    getDropboxAccountEmail: mocks.email,
  };
});

vi.mock('@/lib/supabase-server', () => ({
  createServiceClient: () => ({
    from: () => ({
      upsert: mocks.upsert,
    }),
  }),
}));

import { GET as start } from '@/app/api/auth/dropbox/start/route';
import { GET as callback } from '@/app/api/auth/dropbox/callback/route';

function cookieFor(token: string) {
  const value = `base64-${Buffer.from(JSON.stringify({ access_token: token })).toString('base64url')}`;
  return `sb-example-auth-token=${value}`;
}

function call(path: string, headers?: Record<string, string>) {
  return new NextRequest(`http://localhost${path}`, { headers });
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service';
  process.env.DROPBOX_APP_KEY = 'app-key';
  process.env.DROPBOX_APP_SECRET = 'dropbox-secret';
  mocks.userId = 'admin-1';
  mocks.role = 'admin';
  mocks.authed = true;
  mocks.exchange.mockReset();
  mocks.exchange.mockResolvedValue({
    refresh_token: 'refresh-1',
    access_token: 'access-1',
    expires_in: 14400,
    account_id: 'dbid:1',
  });
  mocks.email.mockClear();
  mocks.upsert.mockClear();
  mocks.upsert.mockResolvedValue({ error: null });
});

describe('Dropbox OAuth auth', () => {
  it('requires a signed-in admin to start, via bearer or session cookie', async () => {
    const missing = await start(call('/api/auth/dropbox/start'));
    expect(missing.status).toBe(401);

    mocks.role = 'founder';
    const founder = await start(
      call('/api/auth/dropbox/start', { authorization: 'Bearer good' })
    );
    expect(founder.status).toBe(403);

    mocks.role = 'admin';
    const admin = await start(call('/api/auth/dropbox/start', { authorization: 'Bearer good' }));
    expect(admin.status).toBe(307);
    const location = new URL(admin.headers.get('location') || '');
    expect(location.hostname).toBe('www.dropbox.com');
    expect(location.searchParams.get('token_access_type')).toBe('offline');
    const state = location.searchParams.get('state');
    expect(state).toBeTruthy();

    const cookieStart = await start(
      call('/api/auth/dropbox/start', { cookie: cookieFor('good') })
    );
    expect(cookieStart.status).toBe(307);
  });

  it('refuses to start when the signing secret is missing', async () => {
    delete process.env.DROPBOX_APP_SECRET;
    const res = await start(call('/api/auth/dropbox/start', { authorization: 'Bearer good' }));
    expect(res.status).toBe(500);
    expect(mocks.exchange).not.toHaveBeenCalled();
  });

  it('requires an admin and a state for that admin before exchanging the code', async () => {
    const anonymous = await callback(call('/api/auth/dropbox/callback?code=abc&state=nope'));
    expect(anonymous.status).toBe(401);
    expect(mocks.exchange).not.toHaveBeenCalled();

    mocks.role = 'founder';
    const founderState = signDropboxOAuthState('admin-1');
    const founder = await callback(
      call(`/api/auth/dropbox/callback?code=abc&state=${encodeURIComponent(founderState || '')}`, {
        authorization: 'Bearer good',
      })
    );
    expect(founder.status).toBe(403);
    expect(mocks.exchange).not.toHaveBeenCalled();

    mocks.role = 'admin';
    mocks.userId = 'admin-1';
    const other = signDropboxOAuthState('admin-2');
    const mismatch = await callback(
      call(`/api/auth/dropbox/callback?code=abc&state=${encodeURIComponent(other || '')}`, {
        authorization: 'Bearer good',
      })
    );
    expect(mismatch.status).toBe(307);
    expect(mismatch.headers.get('location')).toContain('error=invalid_state');
    expect(mocks.exchange).not.toHaveBeenCalled();

    const expired = signDropboxOAuthState('admin-1', Date.now() - 11 * 60 * 1000);
    const stale = await callback(
      call(`/api/auth/dropbox/callback?code=abc&state=${encodeURIComponent(expired || '')}`, {
        authorization: 'Bearer good',
      })
    );
    expect(stale.headers.get('location')).toContain('error=invalid_state');
    expect(mocks.exchange).not.toHaveBeenCalled();

    const tampered = `${signDropboxOAuthState('admin-1')}x`;
    const badSig = await callback(
      call(`/api/auth/dropbox/callback?code=abc&state=${encodeURIComponent(tampered)}`, {
        authorization: 'Bearer good',
      })
    );
    expect(badSig.headers.get('location')).toContain('error=invalid_state');
    expect(mocks.exchange).not.toHaveBeenCalled();
  });

  it('exchanges the code for the admin who signed the state and stores the refresh token', async () => {
    const state = signDropboxOAuthState('admin-1');
    const res = await callback(
      call(`/api/auth/dropbox/callback?code=auth-code&state=${encodeURIComponent(state || '')}`, {
        cookie: cookieFor('good'),
      })
    );
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/admin/dropbox?connected=1');
    expect(mocks.exchange).toHaveBeenCalledWith(
      'auth-code',
      'http://localhost/api/auth/dropbox/callback'
    );
    expect(mocks.upsert).toHaveBeenCalledTimes(1);
    const [payload, options] = mocks.upsert.mock.calls[0];
    expect(payload).toMatchObject({
      service: 'dropbox',
      access_token: 'access-1',
      refresh_token: 'refresh-1',
      account_email: 'ops@example.com',
    });
    expect(options).toEqual({ onConflict: 'service' });
    expect(JSON.stringify(payload)).not.toContain('dropbox-secret');
  });
});
