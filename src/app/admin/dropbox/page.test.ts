import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const state = vi.hoisted(() => ({
  cookies: [] as { name: string; value: string }[],
  role: 'admin' as string | null,
  authed: true,
  reads: 0,
}));

vi.mock('next/headers', () => ({
  cookies: () => ({ getAll: () => state.cookies }),
}));

vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`REDIRECT ${path}`);
  },
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: {
      getUser: async (token: string) => {
        if (!state.authed || token !== 'good') return { data: { user: null }, error: { message: 'bad token' } };
        return { data: { user: { id: 'admin-1' } }, error: null };
      },
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({
            data: state.role ? { role: state.role } : null,
            error: state.role ? null : { message: 'missing' },
          }),
        }),
      }),
    }),
  }),
}));

vi.mock('@/lib/supabase-server', () => ({
  createServiceClient: () => {
    state.reads += 1;
    return {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: {
                service: 'dropbox',
                account_email: 'ops@example.com',
                updated_at: '2026-01-01T00:00:00.000Z',
                refresh_token: 'refresh-token-secret-value',
              },
              error: null,
            }),
          }),
        }),
      }),
    };
  },
}));

import DropboxAdminPage from '@/app/admin/dropbox/page';

function sessionCookie(token: string) {
  const value = `base64-${Buffer.from(JSON.stringify({ access_token: token })).toString('base64url')}`;
  return [{ name: 'sb-example-auth-token', value }];
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service';
  state.cookies = [];
  state.role = 'admin';
  state.authed = true;
  state.reads = 0;
});

describe('/admin/dropbox admin gate', () => {
  it('sends signed-out visitors home and non-admins to submissions', async () => {
    await expect(DropboxAdminPage({ searchParams: {} })).rejects.toThrow(/^REDIRECT \/$/);
    expect(state.reads).toBe(0);

    state.cookies = sessionCookie('good');
    state.role = 'founder';
    await expect(DropboxAdminPage({ searchParams: {} })).rejects.toThrow(/^REDIRECT \/submissions$/);
    expect(state.reads).toBe(0);
  });

  it('shows connection status to an admin without rendering the refresh token', async () => {
    state.cookies = sessionCookie('good');
    const html = renderToStaticMarkup(await DropboxAdminPage({ searchParams: { connected: '1' } }));
    expect(html).toContain('Connected');
    expect(html).toContain('ops@example.com');
    expect(html).toContain('Dropbox connected successfully.');
    expect(html).not.toContain('refresh-token-secret-value');
    expect(state.reads).toBe(1);
  });
});
