import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { retryMissingUsageTasks } from '@/lib/usage-task-sync';
import { sanitizeSecretText } from '@/lib/usage-task';

const SUB_ID = '11111111-1111-4111-8111-111111111111';
const PAGE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const NOTION_KEY = 'ntn_testtokenvalue123';
const SERVICE_KEY = 'service-role-test-value-0123456789';

const submission = {
  id: SUB_ID,
  brand_id: '22222222-2222-4222-8222-222222222222',
  user_id: '33333333-3333-4333-8333-333333333333',
  batch_name: 'MINT-100',
  file_count: 4,
  creator_name: 'Jane Creator',
  creator_social_handle: 'jane',
  is_whitelist: true,
  usage_end_date: '2026-11-01',
  notion_page_id: null,
  notion_page_url: null,
  brands: { name: 'Mintier' },
};

function supabase() {
  return {
    from(table: string) {
      if (table === 'users_profile') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { full_name: 'Nick', email: 'nick@example.com' }, error: null }),
            }),
          }),
        };
      }
      const builder = {
        select: () => builder,
        gte: () => builder,
        eq: () => builder,
        is: async () => ({ data: [{ id: SUB_ID }], error: null }),
        maybeSingle: async () => ({ data: submission, error: null }),
      };
      return builder;
    },
  };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function header(init: RequestInit, name: string): string | null {
  const headers = init.headers;
  if (!headers) return null;
  if (headers instanceof Headers) return headers.get(name);
  if (Array.isArray(headers)) {
    const found = headers.find(([key]) => key.toLowerCase() === name.toLowerCase());
    return found ? found[1] : null;
  }
  const record = headers as Record<string, string>;
  return record[name] ?? record[name.toLowerCase()] ?? null;
}

describe('usage task cron errors', () => {
  const env = {
    NOTION_API_KEY: process.env.NOTION_API_KEY,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    NOTION_TASKS_DATA_SOURCE_ID: process.env.NOTION_TASKS_DATA_SOURCE_ID,
  };

  beforeEach(() => {
    process.env.NOTION_API_KEY = NOTION_KEY;
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY;
    process.env.NOTION_TASKS_DATA_SOURCE_ID = '55b17106-6328-4afd-a945-fb10314a9bb5';
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    vi.unstubAllGlobals();
  });

  it('strips token values and keeps the rest of a Notion message', () => {
    const text = sanitizeSecretText(
      `API token is invalid ${NOTION_KEY} secret_fromnotion123456 Bearer ${SERVICE_KEY}`
    );
    expect(text).toContain('API token is invalid');
    expect(text).toContain('[redacted]');
    expect(text).not.toContain(NOTION_KEY);
    expect(text).not.toContain('secret_fromnotion123456');
    expect(text).not.toContain(SERVICE_KEY);
  });

  it('still creates the task when the client lookup returns a Notion error', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input);
      if (url.includes('/data_sources/') && url.includes('/query')) {
        expect(init.method).toBe('POST');
        expect(header(init, 'Notion-Version')).toBe('2025-09-03');
        expect(init.cache).toBe('no-store');
        return json(404, {
          object: 'error',
          status: 404,
          code: 'object_not_found',
          message: `Could not find data source ${NOTION_KEY}`,
        });
      }
      if (url.endsWith('/v1/pages')) {
        const body = JSON.parse(String(init.body));
        expect(body.parent).toEqual({
          type: 'data_source_id',
          data_source_id: '55b17106-6328-4afd-a945-fb10314a9bb5',
        });
        expect(body.properties.Client).toBeUndefined();
        expect(body.properties.Status).toEqual({ select: { name: 'To Do' } });
        expect(body.properties.Type).toEqual({ select: { name: 'TURN OFF ON DUE DATE' } });
        expect(body.properties.Priority).toEqual({ select: { name: 'P0' } });
        expect(body.properties['Waiting On']).toEqual({ select: { name: 'Internal' } });
        expect(body.properties.Due).toEqual({ date: { start: '2026-11-01' } });
        expect(body.properties.Name.title[0].type).toBe('text');
        expect(body.properties.Notes.rich_text[0].text.content).toContain('Brand: Mintier');
        return json(200, { id: PAGE_ID, url: 'https://www.notion.so/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' });
      }
      expect(url).toContain('/rest/v1/submissions');
      expect(init.method).toBe('PATCH');
      expect(init.cache).toBe('no-store');
      expect(url).toContain('notion_page_id=is.null');
      expect(url).toContain(`id=eq.${SUB_ID}`);
      const written = JSON.parse(String(init.body));
      expect(written.notion_page_id).toBe(PAGE_ID);
      expect(written.notion_page_url).toBe('https://www.notion.so/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
      return json(200, [{ id: SUB_ID, notion_page_id: PAGE_ID }]);
    });
    vi.stubGlobal('fetch', fetchImpl);

    const result = await retryMissingUsageTasks(supabase());

    expect(result.created).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.missingKey).toBe(0);
    expect(result.failures).toEqual([]);
    expect(result.warnings).toEqual([
      {
        submissionId: SUB_ID,
        step: 'client_lookup',
        status: 404,
        code: 'object_not_found',
        message: 'Could not find data source [redacted]',
      },
    ]);
    expect(fetchImpl.mock.calls.some((call) => String(call[0]).includes('/rest/v1/submissions') && call[1]?.method === 'GET')).toBe(
      false
    );
  });

  it('returns the Notion status, code, and sanitized message when page create fails', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input);
      if (url.includes('/query')) {
        return json(200, {
          results: [{ id: 'client-9', properties: { Name: { title: [{ plain_text: 'Mintier' }] } } }],
          has_more: false,
        });
      }
      if (url.endsWith('/v1/pages')) {
        const body = JSON.parse(String(init.body));
        expect(body.properties.Client).toEqual({ relation: [{ id: 'client-9' }] });
        expect(body.properties.Status.select).toEqual({ name: 'To Do' });
        expect(body.properties.Status.status).toBeUndefined();
        return json(400, {
          object: 'error',
          status: 400,
          code: 'validation_error',
          message: `body failed validation ${NOTION_KEY} secret_fromnotion123456`,
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchImpl);

    const result = await retryMissingUsageTasks(supabase());

    expect(result).toMatchObject({ created: 0, failed: 1, missingKey: 0, warnings: [] });
    expect(result.failures).toEqual([
      {
        submissionId: SUB_ID,
        step: 'page_create',
        status: 400,
        code: 'validation_error',
        message: 'body failed validation [redacted] [redacted]',
      },
    ]);
    expect(result.failures[0].message).not.toContain(NOTION_KEY);
    expect(result.failures[0].message).not.toContain('secret_fromnotion123456');
    expect(fetchImpl.mock.calls.some((call) => String(call[0]).includes('/rest/v1/submissions'))).toBe(false);
  });

  it('returns a submissions update failure without echoing the service role key', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input);
      if (url.includes('/query')) {
        return json(200, {
          results: [{ id: 'client-9', properties: { Name: { title: [{ plain_text: 'Mintier' }] } } }],
          has_more: false,
        });
      }
      if (url.endsWith('/v1/pages')) {
        return json(200, { id: PAGE_ID, url: 'https://www.notion.so/page' });
      }
      expect(init.method).toBe('PATCH');
      expect(init.cache).toBe('no-store');
      return json(500, {
        code: 'PGRST204',
        message: `update failed ${SERVICE_KEY}`,
      });
    }));

    const result = await retryMissingUsageTasks(supabase());

    expect(result.created).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.failures).toEqual([
      {
        submissionId: SUB_ID,
        step: 'submissions_update',
        status: 500,
        code: 'PGRST204',
        message: 'update failed [redacted]',
      },
    ]);
    expect(JSON.stringify(result)).not.toContain(SERVICE_KEY);
    expect(JSON.stringify(result)).not.toContain(NOTION_KEY);
  });

  it('does not treat an empty submissions representation as a saved page', async () => {
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/query')) {
        return json(200, { results: [], has_more: false });
      }
      if (url.endsWith('/v1/pages')) {
        return json(200, { id: PAGE_ID, url: 'https://www.notion.so/page' });
      }
      return json(200, []);
    });

    const result = await retryMissingUsageTasks(supabase());

    expect(result.failed).toBe(1);
    expect(result.failures[0]).toMatchObject({
      submissionId: SUB_ID,
      step: 'submissions_update',
      status: 200,
      code: 'not_updated',
      message: 'submissions row was not updated',
    });
  });

  it('counts a missing key without calling Notion', async () => {
    delete process.env.NOTION_API_KEY;
    const fetchImpl = vi.fn();
    vi.stubGlobal('fetch', fetchImpl);
    const result = await retryMissingUsageTasks(supabase());
    expect(result).toEqual({ created: 0, failed: 0, missingKey: 1, failures: [], warnings: [] });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
