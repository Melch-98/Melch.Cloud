import { describe, expect, it, vi } from 'vitest';
import { sanitizeSecretText } from '@/lib/notion-error';
import { createNotionUsageClient } from '@/lib/notion-usage';
import {
  buildUsageTaskCreate,
  matchClient,
  syncUsageTask,
  usageTaskName,
  type NotionUsageClient,
  type UsageSubmissionRow,
  type UsageTaskCreateBody,
} from '@/lib/usage-task';

const row = (overrides: Partial<UsageSubmissionRow> = {}): UsageSubmissionRow => ({
  id: 'sub-1',
  brandName: 'Mintier',
  batchName: 'MINT-100',
  fileCount: 4,
  uploader: 'Nick',
  creatorName: 'Jane Creator',
  creatorHandle: 'jane',
  isWhitelist: true,
  usageEndDate: '2026-11-01',
  notionPageId: null,
  ...overrides,
});

function notionMock(overrides: Partial<NotionUsageClient> = {}): NotionUsageClient {
  return {
    listClients: vi.fn(async () => [{ id: 'client-1', name: 'Mintier' }]),
    createTask: vi.fn(async () => ({ id: 'page-1', url: 'https://www.notion.so/page-1' })),
    updateDue: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe('usage task payload', () => {
  it('matches the Agency Tasks fields and leaves the owned fields unset', () => {
    const body = buildUsageTaskCreate({
      row: row(),
      client: { id: 'client-1', name: 'Mintier' },
      dataSourceId: '55b17106-6328-4afd-a945-fb10314a9bb5',
      appUrl: 'https://melch.cloud',
    });
    expect(body.parent).toEqual({
      type: 'data_source_id',
      data_source_id: '55b17106-6328-4afd-a945-fb10314a9bb5',
    });
    expect(body.properties).toMatchObject({
      Type: { select: { name: 'TURN OFF ON DUE DATE' } },
      Priority: { select: { name: 'P0' } },
      Status: { select: { name: 'To Do' } },
      'Waiting On': { select: { name: 'Internal' } },
      Due: { date: { start: '2026-11-01' } },
      Client: { relation: [{ id: 'client-1' }] },
    });
    expect(body.properties.Name).toEqual({
      title: [{ type: 'text', text: { content: 'Turn off Mintier @jane Whitelisted Ads' } }],
    });
    expect(body.properties.Due).toEqual({ date: { start: '2026-11-01' } });
    const notes = (body.properties.Notes as { rich_text: Array<{ text: { content: string } }> }).rich_text[0].text
      .content;
    expect(notes).toContain('Melch: https://melch.cloud/admin#batch-sub-1');
    expect(notes).toContain('Batch: MINT-100');
    expect(notes).toContain('Files: 4');
    expect(notes).toContain('Uploader: Nick');
    expect(notes).not.toContain('Brand:');
    expect(body.properties).not.toHaveProperty('Handled By');
    expect(body.properties).not.toHaveProperty('Creative Ad');
    expect(body.properties).not.toHaveProperty('Expiry Reminder Sent For');
  });

  it('uses Creator Ads when whitelist is off, and the creator name when there is no handle', () => {
    expect(usageTaskName(row({ isWhitelist: false }))).toBe('Turn off Mintier @jane Creator Ads');
    expect(usageTaskName(row({ creatorHandle: '', creatorName: 'Jane Creator' }))).toBe(
      'Turn off Mintier Jane Creator Whitelisted Ads'
    );
  });

  it('matches a client by brand name and puts an unmatched brand in the notes', () => {
    expect(matchClient([{ id: 'a', name: 'mintier' }], 'Mintier')?.id).toBe('a');
    expect(matchClient([{ id: 'a', name: 'FOND Bone Broth' }], 'Mintier')).toBeNull();
    const body = buildUsageTaskCreate({
      row: row({ brandName: 'Party Patch' }),
      client: null,
      appUrl: 'https://melch.cloud',
    });
    const dated = buildUsageTaskCreate({
      row: row({ usageEndDate: '2026-11-01T15:04:00.000Z' }),
      client: null,
    });
    expect(dated.properties.Due).toEqual({ date: { start: '2026-11-01' } });
    expect(body.properties.Client).toBeUndefined();
    const notes = (body.properties.Notes as { rich_text: Array<{ text: { content: string } }> }).rich_text[0].text
      .content;
    expect(notes).toContain('Brand: Party Patch');
  });
});

describe('syncUsageTask', () => {
  it('updates Due on the existing page instead of creating another', async () => {
    const notion = notionMock();
    const result = await syncUsageTask({
      row: row({ notionPageId: 'page-existing', usageEndDate: '2026-12-01' }),
      notion,
    });
    expect(result).toMatchObject({ ok: true, action: 'updated' });
    expect(notion.updateDue).toHaveBeenCalledWith('page-existing', '2026-12-01');
    expect(notion.createTask).not.toHaveBeenCalled();
    expect(notion.listClients).not.toHaveBeenCalled();
  });

  it('does nothing when the key is missing and leaves the page id unset', async () => {
    const result = await syncUsageTask({ row: row(), notion: null });
    expect(result).toEqual({ ok: true, action: 'missing_key' });
  });

  it('does not throw when Notion fails, so the upload can still succeed', async () => {
    const notion = notionMock({
      createTask: vi.fn(async () => {
        throw new Error('Notion 500');
      }),
    });
    const result = await syncUsageTask({ row: row(), notion });
    expect(result).toMatchObject({
      ok: false,
      action: 'failed',
      failure: { submissionId: 'sub-1', step: 'page_create', status: null, code: null, message: 'Notion 500' },
    });
  });

  it('sends the create body through the Notion client with the data source parent', async () => {
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      if (String(url).includes('/query')) {
        return new Response(
          JSON.stringify({
            results: [{ id: 'client-9', properties: { Name: { title: [{ plain_text: 'mintier' }] } } }],
            has_more: false,
          }),
          { status: 200 }
        );
      }
      const body = JSON.parse(String(init.body));
      expect(init.method).toBe('POST');
      expect((init.headers as Record<string, string>)['Notion-Version']).toBe('2025-09-03');
      expect(body.parent.type).toBe('data_source_id');
      expect(body.properties.Client).toEqual({ relation: [{ id: 'client-9' }] });
      expect(body.properties).not.toHaveProperty('Handled By');
      return new Response(JSON.stringify({ id: 'page-9', url: 'https://www.notion.so/page-9' }), { status: 200 });
    });
    const client = createNotionUsageClient('test-key', fetchImpl);
    const result = await syncUsageTask({ row: row(), notion: client, appUrl: 'https://melch.cloud' });
    expect(result).toMatchObject({
      ok: true,
      action: 'created',
      page: { id: 'page-9', url: 'https://www.notion.so/page-9' },
    });
    expect(String(fetchImpl.mock.calls[0][0])).toBe(
      'https://api.notion.com/v1/data_sources/ec00e9d0-4d83-4c56-911c-602ead732456/query'
    );
    expect((fetchImpl.mock.calls[0][1] as RequestInit).method).toBe('POST');
  });
});

function notionError(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ object: 'error', status, code, message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('Notion error paths', () => {
  const apiKey = 'ntn_live_key_should_not_leak_1234567890';

  it('strips tokens and secrets and keeps the Notion message and ids', () => {
    const message = sanitizeSecretText(
      `body failed validation for 55b17106-6328-4afd-a945-fb10314a9bb5 secret_abcDEF123456 Bearer ${apiKey}`,
      [apiKey]
    );
    expect(message).toContain('body failed validation');
    expect(message).toContain('55b17106-6328-4afd-a945-fb10314a9bb5');
    expect(message).not.toContain('secret_abcDEF123456');
    expect(message).not.toContain(apiKey);
    expect(message).not.toContain('ntn_live');
  });

  it('still creates the task without Client when client lookup fails', async () => {
    const creates: UsageTaskCreateBody[] = [];
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      if (String(url).includes('/query')) {
        return notionError(
          403,
          'restricted_resource',
          `integration token secret_lookupsecretvalue cannot read ${apiKey}`
        );
      }
      creates.push(JSON.parse(String(init.body)) as UsageTaskCreateBody);
      return new Response(JSON.stringify({ id: 'page-created', url: 'https://www.notion.so/page-created' }), {
        status: 200,
      });
    });
    const result = await syncUsageTask({
      row: row(),
      notion: createNotionUsageClient(apiKey, fetchImpl),
      appUrl: 'https://melch.cloud',
    });
    expect(result).toMatchObject({
      ok: true,
      action: 'created',
      page: { id: 'page-created' },
      clientLookupFailure: {
        submissionId: 'sub-1',
        step: 'client_lookup',
        status: 403,
        code: 'restricted_resource',
      },
    });
    expect(result.ok && result.clientLookupFailure?.message).not.toContain('secret_lookupsecretvalue');
    expect(result.ok && result.clientLookupFailure?.message).not.toContain(apiKey);
    expect(result.ok && result.clientLookupFailure?.message).toContain('cannot read');
    expect(creates[0].properties.Client).toBeUndefined();
    expect(creates[0].parent).toEqual({
      type: 'data_source_id',
      data_source_id: '55b17106-6328-4afd-a945-fb10314a9bb5',
    });
  });

  it('returns the Notion status, code, and sanitized message when page create fails', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).includes('/query')) {
        return new Response(
          JSON.stringify({
            results: [{ id: 'client-9', properties: { Name: { title: [{ plain_text: 'Mintier' }] } } }],
            has_more: false,
          }),
          { status: 200 }
        );
      }
      return notionError(400, 'validation_error', `Status.select rejected secret_createfailvalue and ${apiKey}`);
    });
    const result = await syncUsageTask({
      row: row(),
      notion: createNotionUsageClient(apiKey, fetchImpl),
    });
    expect(result).toMatchObject({
      ok: false,
      action: 'failed',
      failure: {
        submissionId: 'sub-1',
        step: 'page_create',
        status: 400,
        code: 'validation_error',
      },
    });
    if (!result.ok) {
      expect(result.failure.message).toContain('Status.select rejected');
      expect(result.failure.message).not.toContain('secret_createfailvalue');
      expect(result.failure.message).not.toContain(apiKey);
      expect(result.error).toBe(result.failure.message);
    }
  });

  it('reports page create when client lookup also failed', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).includes('/query')) {
        return notionError(404, 'object_not_found', 'Could not find data source');
      }
      return notionError(401, 'unauthorized', 'API token is invalid.');
    });
    const result = await syncUsageTask({
      row: row(),
      notion: createNotionUsageClient(apiKey, fetchImpl),
    });
    expect(result).toMatchObject({
      ok: false,
      clientLookupFailure: { step: 'client_lookup', status: 404, code: 'object_not_found' },
      failure: { step: 'page_create', status: 401, code: 'unauthorized', message: 'API token is invalid.' },
    });
  });
});
