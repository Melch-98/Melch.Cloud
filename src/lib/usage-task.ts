/**
 * Agency Tasks page for a batch that has a usage end date.
 * Notion is called only from the server. A missing key or a Notion error
 * does not throw, so the upload that already saved can still succeed.
 */

export const DEFAULT_TASKS_DATA_SOURCE_ID = '55b17106-6328-4afd-a945-fb10314a9bb5';
export const DEFAULT_CLIENTS_DATA_SOURCE_ID = 'ec00e9d0-4d83-4c56-911c-602ead732456';
export const NOTION_VERSION = '2025-09-03';

export interface UsageClient {
  id: string;
  name: string;
}

export interface UsageSubmissionRow {
  id: string;
  brandName: string;
  batchName: string;
  fileCount: number;
  uploader: string;
  creatorName: string | null;
  creatorHandle: string | null;
  isWhitelist: boolean;
  usageEndDate: string | null;
  notionPageId: string | null;
}

export interface NotionPageRef {
  id: string;
  url: string;
}

export interface NotionUsageClient {
  listClients(): Promise<UsageClient[]>;
  createTask(body: UsageTaskCreateBody): Promise<NotionPageRef>;
  updateDue(pageId: string, usageEndDate: string): Promise<void>;
}

export interface UsageTaskCreateBody {
  parent: { type: 'data_source_id'; data_source_id: string };
  properties: Record<string, unknown>;
}

export type UsageTaskResult =
  | { ok: true; action: 'skipped' | 'missing_key' | 'created' | 'updated'; page?: NotionPageRef }
  | { ok: false; action: 'failed'; error: string };

export function tasksDataSourceId(): string {
  return process.env.NOTION_TASKS_DATA_SOURCE_ID || DEFAULT_TASKS_DATA_SOURCE_ID;
}

export function clientsDataSourceId(): string {
  return process.env.NOTION_CLIENTS_DATA_SOURCE_ID || DEFAULT_CLIENTS_DATA_SOURCE_ID;
}

export function creatorLabel(handle: string | null | undefined, name: string | null | undefined): string {
  const trimmedHandle = (handle || '').trim();
  if (trimmedHandle) return trimmedHandle.startsWith('@') ? trimmedHandle : `@${trimmedHandle}`;
  return (name || '').trim();
}

export function usageTaskName(row: Pick<UsageSubmissionRow, 'brandName' | 'creatorName' | 'creatorHandle' | 'isWhitelist'>): string {
  const who = creatorLabel(row.creatorHandle, row.creatorName);
  const kind = row.isWhitelist ? 'Whitelisted Ads' : 'Creator Ads';
  return ['Turn off', row.brandName.trim(), who, kind].filter(Boolean).join(' ');
}

export function batchDetailUrl(submissionId: string, appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://melch.cloud'): string {
  return `${appUrl.replace(/\/$/, '')}/admin#batch-${submissionId}`;
}

export function usageTaskNotes(input: {
  submissionId: string;
  batchName: string;
  fileCount: number;
  uploader: string;
  brandName: string;
  clientMatched: boolean;
  appUrl?: string;
}): string {
  const lines = [
    `Melch: ${batchDetailUrl(input.submissionId, input.appUrl)}`,
    `Batch: ${input.batchName}`,
    `Files: ${input.fileCount}`,
    `Uploader: ${input.uploader}`,
  ];
  if (!input.clientMatched && input.brandName.trim()) {
    lines.push(`Brand: ${input.brandName.trim()}`);
  }
  return lines.join('\n');
}

/** Exact brand name, case-insensitive. Prefers the same capitalization. */
export function matchClient(clients: UsageClient[], brandName: string): UsageClient | null {
  const target = brandName.trim().toLowerCase();
  if (!target) return null;
  const hits = clients.filter((client) => client.name.trim().toLowerCase() === target);
  if (hits.length === 0) return null;
  return hits.find((client) => client.name.trim() === brandName.trim()) || hits[0];
}

const OMITTED_PROPERTIES = ['Handled By', 'Creative Ad', 'Expiry Reminder Sent For'] as const;

export function buildUsageTaskCreate(input: {
  row: UsageSubmissionRow;
  client: UsageClient | null;
  dataSourceId?: string;
  appUrl?: string;
}): UsageTaskCreateBody {
  const notes = usageTaskNotes({
    submissionId: input.row.id,
    batchName: input.row.batchName,
    fileCount: input.row.fileCount,
    uploader: input.row.uploader,
    brandName: input.row.brandName,
    clientMatched: Boolean(input.client),
    appUrl: input.appUrl,
  });
  const properties: Record<string, unknown> = {
    Name: { title: [{ text: { content: usageTaskName(input.row) } }] },
    Type: { select: { name: 'TURN OFF ON DUE DATE' } },
    Priority: { select: { name: 'P0' } },
    Status: { select: { name: 'To Do' } },
    'Waiting On': { select: { name: 'Internal' } },
    Due: { date: { start: input.row.usageEndDate } },
    Notes: { rich_text: [{ text: { content: notes } }] },
  };
  if (input.client) {
    properties.Client = { relation: [{ id: input.client.id }] };
  }
  for (const key of OMITTED_PROPERTIES) {
    delete properties[key];
  }
  return {
    parent: {
      type: 'data_source_id',
      data_source_id: input.dataSourceId || tasksDataSourceId(),
    },
    properties,
  };
}

export function buildDueUpdate(usageEndDate: string): { properties: { Due: { date: { start: string } } } } {
  return { properties: { Due: { date: { start: usageEndDate } } } };
}

export async function syncUsageTask(input: {
  row: UsageSubmissionRow;
  notion: NotionUsageClient | null;
  appUrl?: string;
}): Promise<UsageTaskResult> {
  const date = (input.row.usageEndDate || '').trim();
  if (!date) return { ok: true, action: 'skipped' };

  const existingId = (input.row.notionPageId || '').trim();
  if (existingId) {
    if (!input.notion) {
      console.warn('Usage task was not updated: NOTION_API_KEY is not set', { submissionId: input.row.id });
      return { ok: true, action: 'missing_key' };
    }
    try {
      await input.notion.updateDue(existingId, date);
      return { ok: true, action: 'updated' };
    } catch (error) {
      console.warn('Usage task due date was not updated', {
        submissionId: input.row.id,
        error: error instanceof Error ? error.message : 'notion',
      });
      return { ok: false, action: 'failed', error: 'notion' };
    }
  }

  if (!input.notion) {
    console.warn('Usage task was not created: NOTION_API_KEY is not set', { submissionId: input.row.id });
    return { ok: true, action: 'missing_key' };
  }

  try {
    const clients = await input.notion.listClients();
    const client = matchClient(clients, input.row.brandName);
    const page = await input.notion.createTask(
      buildUsageTaskCreate({ row: { ...input.row, usageEndDate: date }, client, appUrl: input.appUrl })
    );
    return { ok: true, action: 'created', page };
  } catch (error) {
    console.warn('Usage task was not created', {
      submissionId: input.row.id,
      error: error instanceof Error ? error.message : 'notion',
    });
    return { ok: false, action: 'failed', error: 'notion' };
  }
}
