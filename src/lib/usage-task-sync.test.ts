import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { NotionApiError } from '@/lib/notion-error';
import type { NotionUsageClient } from '@/lib/usage-task';

const { authenticateRequest, notionHolder, supabaseHolder } = vi.hoisted(() => ({
  authenticateRequest: vi.fn(),
  notionHolder: { current: null as NotionUsageClient | null },
  supabaseHolder: { current: null as { from: (table: string) => unknown } | null },
}));

vi.mock('@/lib/auth', () => ({
  authenticateRequest,
}));

vi.mock('@/lib/notion-usage', () => ({
  createNotionUsageClient: () => notionHolder.current,
}));

vi.mock('@/lib/supabase-server', () => ({
  createServiceClient: () => supabaseHolder.current,
}));

import { GET } from '@/app/api/cron/usage-tasks/route';
import { POST } from '@/app/api/submissions/usage-task/route';
import { retryMissingUsageTasks } from '@/lib/usage-task-sync';

const submissionRow = {
  id: 'sub-1',
  brand_id: 'brand-1',
  user_id: 'user-1',
  batch_name: 'MINT-100',
  file_count: 2,
  creator_name: 'Jane',
  creator_social_handle: 'jane',
  is_whitelist: true,
  usage_end_date: '2026-11-01',
  notion_page_id: null,
  notion_page_url: null,
  brands: { name: 'Mintier' },
};

function supabaseStub(updateError: { message: string } | null) {
  return {
    from(table: string) {
      if (table === 'users_profile') {
        return {
          select() {
            return {
              eq() {
                return {
                  maybeSingle: async () => ({ data: { full_name: 'Nick', email: 'nick@melch.cloud' }, error: null }),
                };
              },
            };
          },
        };
      }
      return {
        select(columns: string) {
          if (columns === 'id') {
            return {
              gte() {
                return { is: async () => ({ data: [{ id: 'sub-1' }], error: null }) };
              },
            };
          }
          return {
            eq() {
              return { maybeSingle: async () => ({ data: submissionRow, error: null }) };
            },
          };
        },
        update() {
          return {
            eq() {
              return { is: async () => ({ error: updateError }) };
            },
          };
        },
      };
    },
  };
}

function caller(role: 'admin' | 'founder') {
  return {
    auth: {
      user_id: 'user-1',
      email: 'nick@melch.cloud',
      role,
      brand_id: 'brand-1',
      permissions: {
        can_upload: true,
        can_view_pipeline: true,
        can_download: true,
        can_delete: false,
        is_active: true,
      },
    },
  };
}

describe('usage task retry errors', () => {
  beforeEach(() => {
    process.env.NOTION_API_KEY = 'ntn_test_key_value_should_stay_hidden';
    process.env.CRON_SECRET = 'cron-secret';
    notionHolder.current = null;
    supabaseHolder.current = null;
    authenticateRequest.mockReset();
  });

  it('counts a submissions update failure and redacts the database error', async () => {
    notionHolder.current = {
      listClients: async () => [{ id: 'client-1', name: 'Mintier' }],
      createTask: async () => ({ id: 'page-1', url: 'https://www.notion.so/page-1' }),
      updateDue: async () => undefined,
    };
    const supabase = supabaseStub({ message: 'update failed secret_dbwritevalue123456' });
    const result = await retryMissingUsageTasks(supabase, new Date('2026-10-10T12:00:00Z'));
    expect(result.created).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.missingKey).toBe(0);
    expect(result.failures).toEqual([
      {
        submissionId: 'sub-1',
        step: 'submissions_update',
        status: null,
        code: null,
        message: 'update failed [redacted]',
        notionPageId: 'page-1',
      },
    ]);
    expect(result.warnings).toEqual([]);
    expect(JSON.stringify(result)).not.toContain('secret_dbwritevalue123456');
  });

  it('returns sanitized failures only to the cron secret', async () => {
    notionHolder.current = {
      listClients: async () => {
        throw new NotionApiError(400, 'validation_error', 'query failed secret_queryvalue1234567890');
      },
      createTask: async () => {
        throw new NotionApiError(400, 'validation_error', 'page failed secret_pagevalue1234567890');
      },
      updateDue: async () => undefined,
    };
    supabaseHolder.current = supabaseStub(null);

    const denied = await GET(new NextRequest('http://localhost/api/cron/usage-tasks'));
    expect(denied.status).toBe(401);
    const deniedBody = await denied.json();
    expect(deniedBody).toEqual({ error: 'Unauthorized' });

    const res = await GET(
      new NextRequest('http://localhost/api/cron/usage-tasks', {
        headers: { authorization: 'Bearer cron-secret' },
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.created).toBe(0);
    expect(body.failed).toBe(1);
    expect(body.failures).toEqual([
      {
        submissionId: 'sub-1',
        step: 'page_create',
        status: 400,
        code: 'validation_error',
        message: 'page failed [redacted]',
      },
    ]);
    expect(body.warnings).toEqual([
      {
        submissionId: 'sub-1',
        step: 'client_lookup',
        status: 400,
        code: 'validation_error',
        message: 'query failed [redacted]',
      },
    ]);
    expect(JSON.stringify(body)).not.toContain('secret_');
    expect(JSON.stringify(body)).not.toContain(process.env.NOTION_API_KEY);
  });

  it('returns the failure to an admin and omits it for a founder', async () => {
    notionHolder.current = {
      listClients: async () => [{ id: 'client-1', name: 'Mintier' }],
      createTask: async () => {
        throw new NotionApiError(400, 'validation_error', 'select mismatch secret_adminleakvalue12345');
      },
      updateDue: async () => undefined,
    };
    supabaseHolder.current = supabaseStub(null);
    const request = () =>
      new NextRequest('http://localhost/api/submissions/usage-task', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ submission_id: 'sub-1' }),
      });

    authenticateRequest.mockResolvedValue(caller('admin'));
    const adminRes = await POST(request());
    const adminBody = await adminRes.json();
    expect(adminBody.taskOk).toBe(false);
    expect(adminBody.failure).toMatchObject({
      step: 'page_create',
      status: 400,
      code: 'validation_error',
    });
    expect(adminBody.failure.message).not.toContain('secret_adminleakvalue12345');

    authenticateRequest.mockResolvedValue(caller('founder'));
    const founderRes = await POST(request());
    const founderBody = await founderRes.json();
    expect(founderBody.taskOk).toBe(false);
    expect(founderBody.action).toBe('failed');
    expect(founderBody.failure).toBeUndefined();
    expect(founderBody.warning).toBeUndefined();
    expect(JSON.stringify(founderBody)).not.toContain('secret_');
    expect(JSON.stringify(founderBody)).not.toContain('validation_error');
  });
});
