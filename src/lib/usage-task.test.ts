import { describe, expect, it, vi } from 'vitest';
import { createNotionUsageClient } from '@/lib/notion-usage';
import {
  buildUsageTaskCreate,
  matchClient,
  syncUsageTask,
  usageTaskName,
  type NotionUsageClient,
  type UsageSubmissionRow,
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
      title: [{ text: { content: 'Turn off Mintier @jane Whitelisted Ads' } }],
    });
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
    expect(result).toEqual({ ok: false, action: 'failed', error: 'notion' });
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
  });
});
