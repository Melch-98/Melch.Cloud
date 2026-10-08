import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { EXISTING_ACCOUNT_MESSAGE } from '@/lib/invite-access';

const SECRET = 'super-secret-hash';

type Profile = {
  id: string;
  email: string;
  role: string;
  brand_id: string | null;
  full_name: string;
};

type AuthUser = { id: string; email: string; last_sign_in_at: string | null };

const { state, sendInviteEmail } = vi.hoisted(() => {
  const state = {
    callerId: 'founder-1',
    callerEmail: 'founder@brand.com',
    generateLinkCalls: 0,
    generateLinkError: null as { message: string; status?: number } | null,
    createUserCalls: [] as { email?: string; password?: string }[],
    createUserError: null as { message: string } | null,
    passwordUpdates: [] as unknown[],
    inserts: [] as { table: string; payload: unknown }[],
    upserts: [] as { table: string; payload: unknown }[],
    updates: [] as { table: string; payload: unknown }[],
    profiles: [] as Profile[],
    authUsers: [] as AuthUser[],
  };
  return { state, sendInviteEmail: vi.fn() };
});

vi.mock('@/lib/invite-mail', () => ({
  sendInviteEmail,
}));

vi.mock('@/lib/dropbox', () => ({
  ensureDropboxFolder: vi.fn(),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: {
      getUser: async (token: string) => {
        if (token !== 'good') return { data: { user: null }, error: { message: 'bad token' } };
        return { data: { user: { id: state.callerId, email: state.callerEmail } }, error: null };
      },
      admin: {
        listUsers: async () => ({ data: { users: state.authUsers }, error: null }),
        getUserById: async (id: string) => {
          const user = state.authUsers.find((row) => row.id === id);
          if (!user) return { data: { user: null }, error: { message: 'missing' } };
          return { data: { user }, error: null };
        },
        generateLink: async () => {
          state.generateLinkCalls += 1;
          if (state.generateLinkError) return { data: null, error: state.generateLinkError };
          return {
            data: {
              user: { id: 'new-user' },
              properties: {
                hashed_token: SECRET,
                verification_type: 'invite',
                action_link: `https://supabase.example/verify?token=${SECRET}`,
              },
            },
            error: null,
          };
        },
        createUser: async (args: { email?: string; password?: string }) => {
          state.createUserCalls.push(args);
          if (state.createUserError) return { data: { user: null }, error: state.createUserError };
          return { data: { user: { id: 'created-user' } }, error: null };
        },
        updateUserById: async (id: string, attrs: unknown) => {
          state.passwordUpdates.push({ id, attrs });
          return { data: { user: { id } }, error: null };
        },
        deleteUser: async () => ({ error: null }),
      },
    },
    from(table: string) {
      const filters: { op: string; col: string; val: unknown }[] = [];
      let operation: 'select' | 'insert' | 'upsert' | 'update' = 'select';
      const api: Record<string, unknown> = {};
      const chain = () => api;
      api.select = chain;
      api.eq = (col: string, val: unknown) => {
        filters.push({ op: 'eq', col, val });
        return api;
      };
      api.ilike = (col: string, val: unknown) => {
        filters.push({ op: 'ilike', col, val });
        return api;
      };
      api.in = chain;
      api.limit = chain;
      api.insert = (payload: unknown) => {
        operation = 'insert';
        state.inserts.push({ table, payload });
        return api;
      };
      api.upsert = (payload: unknown) => {
        operation = 'upsert';
        state.upserts.push({ table, payload });
        return api;
      };
      api.update = (payload: unknown) => {
        operation = 'update';
        state.updates.push({ table, payload });
        return api;
      };
      api.maybeSingle = async () => project(true);
      api.single = async () => project(false);
      api.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
        Promise.resolve(project(true)).then(resolve, reject);

      function project(asOne: boolean) {
        if (operation !== 'select') return { data: null, error: null };
        if (table === 'brands') {
          const id = filters.find((filter) => filter.col === 'id')?.val;
          return { data: { id, name: 'Owned Brand' }, error: null };
        }
        if (table !== 'users_profile') return { data: null, error: null };
        const rows = state.profiles.filter((row) =>
          filters.every((filter) => {
            const left = String((row as Record<string, unknown>)[filter.col] ?? '');
            const right = String(filter.val ?? '');
            return filter.op === 'ilike' ? left.toLowerCase() === right.toLowerCase() : left === right;
          })
        );
        if (filters.some((filter) => filter.op === 'ilike')) return { data: rows, error: null };
        const row = rows[0] ?? null;
        if (!row && !asOne) return { data: null, error: { message: 'not found' } };
        return { data: row, error: null };
      }
      return api;
    },
  }),
}));

function resetState() {
  state.callerId = 'founder-1';
  state.callerEmail = 'founder@brand.com';
  state.generateLinkCalls = 0;
  state.generateLinkError = null;
  state.createUserCalls = [];
  state.createUserError = null;
  state.passwordUpdates = [];
  state.inserts = [];
  state.upserts = [];
  state.updates = [];
  state.profiles = [
    {
      id: 'founder-1',
      email: 'founder@brand.com',
      role: 'founder',
      brand_id: 'brand-own',
      full_name: 'Founder',
    },
    {
      id: 'admin-1',
      email: 'nick@melch.media',
      role: 'admin',
      brand_id: null,
      full_name: 'Nick',
    },
    {
      id: 'member-1',
      email: 'member@brand.com',
      role: 'strategist',
      brand_id: 'brand-own',
      full_name: 'Member',
    },
    {
      id: 'pending-1',
      email: 'pending@brand.com',
      role: 'strategist',
      brand_id: 'brand-own',
      full_name: 'Pending',
    },
    {
      id: 'other-1',
      email: 'other@elsewhere.com',
      role: 'strategist',
      brand_id: 'brand-other',
      full_name: 'Other',
    },
  ];
  state.authUsers = [
    { id: 'founder-1', email: 'founder@brand.com', last_sign_in_at: '2026-01-01T00:00:00Z' },
    { id: 'admin-1', email: 'nick@melch.media', last_sign_in_at: '2026-01-02T00:00:00Z' },
    { id: 'member-1', email: 'member@brand.com', last_sign_in_at: '2026-02-01T00:00:00Z' },
    { id: 'pending-1', email: 'pending@brand.com', last_sign_in_at: null },
    { id: 'other-1', email: 'other@elsewhere.com', last_sign_in_at: null },
  ];
}

function post(url: string, body: unknown) {
  return new NextRequest(url, {
    method: 'POST',
    headers: {
      authorization: 'Bearer good',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

function nick() {
  return state.profiles.find((row) => row.id === 'admin-1');
}

describe('invite account takeover', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test';
    resetState();
    sendInviteEmail.mockReset();
    sendInviteEmail.mockResolvedValue({
      delivery: {
        delivered: false,
        message: 'RESEND_API_KEY is not set',
        showCopyLink: true,
        resendMessageId: null,
      },
    });
  });

  it('does not let a founder overwrite an existing admin or receive a set-password link', async () => {
    const { POST } = await import('./create-user/route');
    const res = await POST(
      post('http://localhost/api/admin/create-user', {
        email: 'Nick@melch.media',
        role: 'strategist',
        brandId: 'brand-own',
        sendWelcomeEmail: false,
      })
    );
    const body = await res.json();
    expect(res.status).toBe(409);
    expect(body.error).toBe(EXISTING_ACCOUNT_MESSAGE);
    expect(state.generateLinkCalls).toBe(0);
    expect(state.upserts).toEqual([]);
    expect(state.inserts).toEqual([]);
    expect(state.passwordUpdates).toEqual([]);
    expect(sendInviteEmail).not.toHaveBeenCalled();
    expect(JSON.stringify(body)).not.toContain(SECRET);
    expect(nick()).toMatchObject({ role: 'admin', brand_id: null, email: 'nick@melch.media' });
  });

  it('blocks a founder when the email exists in auth but has no profile', async () => {
    state.profiles = state.profiles.filter((row) => row.id !== 'admin-1');
    const { POST } = await import('./create-user/route');
    const res = await POST(
      post('http://localhost/api/admin/create-user', {
        email: 'nick@melch.media',
        role: 'strategist',
        brandId: 'brand-own',
      })
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe(EXISTING_ACCOUNT_MESSAGE);
    expect(state.generateLinkCalls).toBe(0);
    expect(state.upserts).toEqual([]);
  });

  it('never returns a set-password link to a founder, and still sends the email', async () => {
    const { POST } = await import('./create-user/route');
    const res = await POST(
      post('http://localhost/api/admin/create-user', {
        email: 'new@brand.com',
        role: 'strategist',
        brandId: 'brand-own',
        sendWelcomeEmail: false,
      })
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.invite.actionLink).toBeNull();
    expect(JSON.stringify(body)).not.toContain(SECRET);
    expect(sendInviteEmail).toHaveBeenCalledOnce();
    expect(state.upserts).toEqual([]);
    expect(state.inserts.some((row) => row.table === 'users_profile')).toBe(true);
    expect(nick()).toMatchObject({ role: 'admin', brand_id: null });
  });

  it('still gives an admin the copyable link when Resend does not accept the send', async () => {
    state.callerId = 'admin-1';
    state.callerEmail = 'nick@melch.media';
    const { POST } = await import('./create-user/route');
    const res = await POST(
      post('http://localhost/api/admin/create-user', {
        email: 'new@brand.com',
        role: 'strategist',
        brandId: 'brand-own',
      })
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.invite.actionLink).toContain(SECRET);
  });

  it('does not let a temp password change an existing account', async () => {
    state.callerId = 'admin-1';
    state.callerEmail = 'nick@melch.media';
    state.generateLinkError = { message: 'link service down' };
    state.createUserError = { message: 'A user with this email address has already been registered' };
    state.authUsers = state.authUsers.filter((row) => row.email !== 'victim@brand.com');
    const { POST } = await import('./create-user/route');
    const res = await POST(
      post('http://localhost/api/admin/create-user', {
        email: 'victim@brand.com',
        role: 'strategist',
        brandId: 'brand-own',
        tempPassword: 'hunter22-long',
      })
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe(EXISTING_ACCOUNT_MESSAGE);
    expect(state.passwordUpdates).toEqual([]);
    expect(state.createUserCalls.some((call) => call.password)).toBe(true);
    expect(state.upserts).toEqual([]);
  });

  it('ignores a temp password from a founder', async () => {
    state.generateLinkError = { message: 'link service down' };
    state.createUserError = { message: 'database unavailable' };
    const { POST } = await import('./create-user/route');
    const res = await POST(
      post('http://localhost/api/admin/create-user', {
        email: 'new@brand.com',
        role: 'strategist',
        brandId: 'brand-own',
        tempPassword: 'hunter22-long',
      })
    );
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(state.passwordUpdates).toEqual([]);
    expect(state.createUserCalls.some((call) => call.password)).toBe(false);
    expect(JSON.stringify(body)).not.toContain('hunter22-long');
    expect(JSON.stringify(body)).not.toContain(SECRET);
  });

  it('does not let a founder resend a link for someone who already signed in', async () => {
    const { POST } = await import('./resend-invite/route');
    const res = await POST(post('http://localhost/api/admin/resend-invite', { userId: 'member-1' }));
    const body = await res.json();
    expect(res.status).toBe(403);
    expect(state.generateLinkCalls).toBe(0);
    expect(body.actionLink ?? null).toBeNull();
    expect(JSON.stringify(body)).not.toContain(SECRET);
  });

  it('does not return a link when a founder resends for someone who has never signed in', async () => {
    const { POST } = await import('./resend-invite/route');
    const res = await POST(post('http://localhost/api/admin/resend-invite', { userId: 'pending-1' }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.actionLink).toBeNull();
    expect(JSON.stringify(body)).not.toContain(SECRET);
    expect(sendInviteEmail).toHaveBeenCalledOnce();
  });

  it('does not let a founder resend for an admin or for another brand', async () => {
    state.profiles.push({
      id: 'pending-admin',
      email: 'pending-admin@brand.com',
      role: 'admin',
      brand_id: 'brand-own',
      full_name: 'Pending Admin',
    });
    state.authUsers.push({ id: 'pending-admin', email: 'pending-admin@brand.com', last_sign_in_at: null });
    const { POST } = await import('./resend-invite/route');
    const adminRes = await POST(post('http://localhost/api/admin/resend-invite', { userId: 'pending-admin' }));
    const otherRes = await POST(post('http://localhost/api/admin/resend-invite', { userId: 'other-1' }));
    expect(adminRes.status).toBe(403);
    expect(otherRes.status).toBe(403);
    expect(state.generateLinkCalls).toBe(0);
  });

  it('rejects a founder onboard invite for an existing account before any link is minted', async () => {
    const { POST } = await import('./onboard/route');
    const res = await POST(
      post('http://localhost/api/admin/onboard', {
        action: 'create_users',
        brand_id: 'brand-own',
        sendWelcomeEmail: false,
        users: [{ email: 'nick@melch.media', full_name: 'Nick', role: 'strategist' }],
      })
    );
    const body = await res.json();
    expect(res.status).toBe(409);
    expect(body.error).toBe(EXISTING_ACCOUNT_MESSAGE);
    expect(state.generateLinkCalls).toBe(0);
    expect(state.upserts).toEqual([]);
    expect(state.inserts).toEqual([]);
    expect(JSON.stringify(body)).not.toContain(SECRET);
    expect(nick()).toMatchObject({ role: 'admin', brand_id: null });
  });

  it('does not return a link from onboard when the founder invites a new person', async () => {
    const { POST } = await import('./onboard/route');
    const res = await POST(
      post('http://localhost/api/admin/onboard', {
        action: 'create_users',
        brand_id: 'brand-own',
        sendWelcomeEmail: false,
        users: [{ email: 'new@brand.com', full_name: 'New', role: 'strategist' }],
      })
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.results[0].actionLink).toBeNull();
    expect(JSON.stringify(body)).not.toContain(SECRET);
    expect(sendInviteEmail).toHaveBeenCalledOnce();
  });

  it('blocks a founder from creating, archiving, or editing another brand', async () => {
    const { POST } = await import('./onboard/route');
    const cases = [
      { action: 'create_brand', name: 'Stolen' },
      { action: 'archive_brand', brand_id: 'brand-other' },
      { action: 'restore_brand', brand_id: 'brand-other' },
      { action: 'set_integrations', brand_id: 'brand-other', meta_ad_account_id: 'act_1' },
      { action: 'set_dropbox', brand_id: 'brand-other', dropbox_folder_path: '/stolen' },
    ];
    for (const body of cases) {
      const res = await POST(post('http://localhost/api/admin/onboard', body));
      expect(res.status, body.action).toBe(403);
    }
    expect(state.inserts).toEqual([]);
    expect(state.updates).toEqual([]);
    expect(state.upserts).toEqual([]);
  });
});
